// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

/**
 * BlockLotto (MVP)
 * - Range: 0–999
 * - Entry: fixed 5 USDC (6 decimals)
 * - Split: 70/15/5 to 1st/2nd/3rd, 10% platform
 * - Rollover: only 1st tier rolls over if no exact winners
 * - Round length: 24h (created by owner)
 * - Chain: Base (USDC)
 */

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

interface IVRFCoordinatorV2Plus {
    function requestRandomWords(
        bytes32 keyHash,
        uint256 subId,
        uint16 requestConfirmations,
        uint32 callbackGasLimit,
        uint32 numWords
    ) external returns (uint256 requestId);
}

interface IVRFConsumer {
    function rawFulfillRandomWords(uint256 requestId, uint256[] calldata randomWords) external;
}

contract BlockLotto is ReentrancyGuard, Ownable, IVRFConsumer {
    // fixed parameters
    uint256 public constant ENTRY_USDC_6D = 5_000_000; // 5 USDC (6 decimals)
    uint16  public constant RANGE_MAX = 999;
    uint16  public constant PCT_DEN = 10_000;
    uint16  public constant PCT_1 = 7000; // 70%
    uint16  public constant PCT_2 = 1500; // 15%
    uint16  public constant PCT_3 =  500; // 5%
    uint16  public constant PCT_F = 1000; // 10%
    uint256 public constant SCALE = 1e18; // fixed-point for per-unit payouts

    // VRF config (set via owner)
    IVRFCoordinatorV2Plus public vrf;
    bytes32 public vrfKeyHash;
    uint256 public vrfSubId;
    uint16  public vrfConfirmations = 3;
    uint32  public vrfCallbackGasLimit = 250_000;

    IERC20 public immutable usdc;
    address public feeTreasury;

    struct Round {
        uint64  openTime;
        uint64  closeTime;
        uint64  revealTime;     // New: when reveal phase starts
        uint32  winning;        // 0..999 after VRF
        uint256 totalDeposits;
        uint256 carry1;         // first-tier rollover
        bool    drawn;
        bool    settled;
    }

    struct Commit {
        bytes32 commitment; // keccak256(pick, nonce)
        uint256 stake;
        bool revealed;
    }

    // stake bookkeeping
    mapping(uint256 => mapping(uint16 => uint256)) public stakeByPick; // round -> pick -> total stake
    mapping(uint256 => mapping(address => mapping(uint16 => uint256))) public userStakeByPick;
    mapping(uint256 => mapping(address => uint16[])) private userPicksIndex;
    mapping(uint256 => mapping(address => mapping(uint16 => bool))) private userPickSeen;

    // commit-reveal mappings
    mapping(uint256 => mapping(address => Commit[])) public userCommits; // round -> user -> commits[]
    mapping(uint256 => uint256) public totalCommitments; // round -> total number of commitments

    // claims
    mapping(uint256 => mapping(address => uint256)) public claimed;
    struct UnitPayout { uint256 exact; uint256 last2; uint256 last1; } // scaled by 1e18
    mapping(uint256 => UnitPayout) public unit;

    mapping(uint256 => Round) public rounds;
    uint256 public currentRoundId;
    uint256 public platformFeesAccrued;
    mapping(uint256 => uint256) public requestRound; // VRF request -> round
    // keep winning number hidden until settlement
    mapping(uint256 => uint32) private pendingWinning;
    mapping(uint256 => bool) private hasPendingWinning;

    event RoundCreated(uint256 indexed roundId, uint64 openTime, uint64 closeTime, uint64 revealTime);
    event Committed(uint256 indexed roundId, address indexed user, bytes32 commitment, uint256 stake);
    event Revealed(uint256 indexed roundId, address indexed user, uint16 pick, uint256 nonce, uint256 stake);
    event Entered(uint256 indexed roundId, address indexed user, uint16 pick, uint256 stake); // Legacy event for backward compatibility
    event RandomRequested(uint256 indexed roundId, uint256 requestId);
    event RandomFulfilled(uint256 indexed roundId, uint32 winning);
    event Settled(uint256 indexed roundId, uint256 pool1, uint256 pool2, uint256 pool3, uint256 fee);
    event Claimed(uint256 indexed roundId, address indexed user, uint256 amount);
    event FeesWithdrawn(uint256 amount, address to);

    modifier onlyDuring(uint256 roundId) {
        Round memory r = rounds[roundId];
        require(block.timestamp >= r.openTime && block.timestamp < r.closeTime, "not open");
        _;
    }
    modifier onlyDuringCommit(uint256 roundId) {
        Round memory r = rounds[roundId];
        require(block.timestamp >= r.openTime && block.timestamp < r.closeTime, "commit not open");
        _;
    }
    modifier onlyDuringReveal(uint256 roundId) {
        Round memory r = rounds[roundId];
        require(block.timestamp >= r.closeTime && block.timestamp < r.revealTime, "reveal not open");
        _;
    }
    modifier onlyAfterReveal(uint256 roundId) {
        require(block.timestamp >= rounds[roundId].revealTime, "reveal not closed");
        _;
    }
    modifier onlyAfterClose(uint256 roundId) {
        require(block.timestamp >= rounds[roundId].closeTime, "not closed");
        _;
    }

    constructor(address _usdc, address _feeTreasury) Ownable(msg.sender) {
        require(_usdc != address(0) && _feeTreasury != address(0), "bad addr");
        usdc = IERC20(_usdc);
        feeTreasury = _feeTreasury;
    }

    // ------- admin -------
    function setVRF(address coordinator, bytes32 keyHash, uint256 subId) external onlyOwner {
        vrf = IVRFCoordinatorV2Plus(coordinator);
        vrfKeyHash = keyHash;
        vrfSubId = subId;
    }
    function setVRFParams(uint16 conf, uint32 gasLimit) external onlyOwner { vrfConfirmations = conf; vrfCallbackGasLimit = gasLimit; }
    function setFeeTreasury(address to) external onlyOwner { require(to!=address(0),"0"); feeTreasury = to; }

    // ------- lifecycle -------
    function createRound(uint64 openTime, uint64 closeTime, uint64 revealTime) external onlyOwner returns (uint256 id) {
        require(closeTime > openTime && revealTime > closeTime && revealTime > block.timestamp, "bad times");
        id = ++currentRoundId;
        rounds[id] = Round({
            openTime: openTime,
            closeTime: closeTime,
            revealTime: revealTime,
            winning: 0,
            totalDeposits: 0,
            carry1: (id>1? rounds[id-1].carry1 : 0),
            drawn: false,
            settled: false
        });
        emit RoundCreated(id, openTime, closeTime, revealTime);
    }

    // Commit phase: users submit commitment without revealing their pick
    function commitPick(uint256 roundId, bytes32 commitment) external nonReentrant onlyDuringCommit(roundId) {
        require(usdc.transferFrom(msg.sender, address(this), ENTRY_USDC_6D), "xfer");
        
        userCommits[roundId][msg.sender].push(Commit({
            commitment: commitment,
            stake: ENTRY_USDC_6D,
            revealed: false
        }));
        
        totalCommitments[roundId]++;
        rounds[roundId].totalDeposits += ENTRY_USDC_6D;
        
        emit Committed(roundId, msg.sender, commitment, ENTRY_USDC_6D);
    }

    // Reveal phase: users reveal their pick and nonce to prove their commitment
    function revealPick(uint256 roundId, uint16 pick, uint256 nonce, uint256 commitIndex) external onlyDuringReveal(roundId) {
        require(pick <= RANGE_MAX, "bad pick");
        require(commitIndex < userCommits[roundId][msg.sender].length, "invalid commit index");
        
        Commit storage commit = userCommits[roundId][msg.sender][commitIndex];
        require(!commit.revealed, "already revealed");
        require(commit.commitment == keccak256(abi.encodePacked(pick, nonce)), "invalid reveal");
        
        commit.revealed = true;
        
        // Update stake tracking
        stakeByPick[roundId][pick] += commit.stake;
        if (!userPickSeen[roundId][msg.sender][pick]) {
            userPickSeen[roundId][msg.sender][pick] = true;
            userPicksIndex[roundId][msg.sender].push(pick);
        }
        userStakeByPick[roundId][msg.sender][pick] += commit.stake;
        
        emit Revealed(roundId, msg.sender, pick, nonce, commit.stake);
        emit Entered(roundId, msg.sender, pick, commit.stake); // For backward compatibility
    }

    /**
     * Relayer-enabled reveal: anyone can submit the reveal on behalf of `user`
     * if they present a valid user signature over the reveal payload. The signature
     * binds the contract address and chainId to prevent cross-contract/chain replay.
     *
     * Message signed (EIP-191 personal_sign):
     * keccak256(abi.encode(
     *   address(this),
     *   block.chainid,
     *   roundId,
     *   user,
     *   pick,
     *   nonce,
     *   commitIndex
     * ))
     */
    function revealPickFor(
        uint256 roundId,
        address user,
        uint16 pick,
        uint256 nonce,
        uint256 commitIndex,
        bytes calldata signature
    ) external onlyDuringReveal(roundId) {
        require(user != address(0), "bad user");
        require(pick <= RANGE_MAX, "bad pick");
        require(commitIndex < userCommits[roundId][user].length, "invalid commit index");

        // Verify signature
        bytes32 msgHash = keccak256(abi.encode(address(this), block.chainid, roundId, user, pick, nonce, commitIndex));
        // EIP-191 personal_sign prefix
        bytes32 ethSigned = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", msgHash));
        address signer = ECDSA.recover(ethSigned, signature);
        require(signer == user, "bad sig");

        Commit storage commit = userCommits[roundId][user][commitIndex];
        require(!commit.revealed, "already revealed");
        require(commit.commitment == keccak256(abi.encodePacked(pick, nonce)), "invalid reveal");

        commit.revealed = true;

        // Update stake tracking for the user
        stakeByPick[roundId][pick] += commit.stake;
        if (!userPickSeen[roundId][user][pick]) {
            userPickSeen[roundId][user][pick] = true;
            userPicksIndex[roundId][user].push(pick);
        }
        userStakeByPick[roundId][user][pick] += commit.stake;

        emit Revealed(roundId, user, pick, nonce, commit.stake);
        emit Entered(roundId, user, pick, commit.stake); // For backward compatibility
    }

    // Legacy function for backward compatibility (now deprecated)
    function enter(uint256 roundId, uint16 pick) external nonReentrant onlyDuring(roundId) {
        require(pick <= RANGE_MAX, "bad pick");
        require(usdc.transferFrom(msg.sender, address(this), ENTRY_USDC_6D), "xfer");
        rounds[roundId].totalDeposits += ENTRY_USDC_6D;
        stakeByPick[roundId][pick] += ENTRY_USDC_6D;
        if (!userPickSeen[roundId][msg.sender][pick]) {
            userPickSeen[roundId][msg.sender][pick] = true;
            userPicksIndex[roundId][msg.sender].push(pick);
        }
        userStakeByPick[roundId][msg.sender][pick] += ENTRY_USDC_6D;
        emit Entered(roundId, msg.sender, pick, ENTRY_USDC_6D);
    }

    function closeAndRequestRandom(uint256 roundId) external onlyAfterReveal(roundId) {
        Round storage r = rounds[roundId];
        require(!r.drawn, "requested");
        require(address(vrf)!=address(0), "vrf unset");
        uint256 reqId = vrf.requestRandomWords(vrfKeyHash, vrfSubId, vrfConfirmations, vrfCallbackGasLimit, 1);
        requestRound[reqId] = roundId;
        r.drawn = true;
        emit RandomRequested(roundId, reqId);
    }

    function rawFulfillRandomWords(uint256 requestId, uint256[] calldata randomWords) external override {
        require(msg.sender == address(vrf), "only vrf");
        uint256 roundId = requestRound[requestId];
        Round storage r = rounds[roundId];
        require(r.drawn && r.winning == 0, "fulfilled");
        // keep hidden until settlement
        pendingWinning[roundId] = uint32(randomWords[0] % (RANGE_MAX + 1));
        hasPendingWinning[roundId] = true;
        // Do not leak the number via logs
        emit RandomFulfilled(roundId, 0);
    }

    function settle(uint256 roundId) external onlyAfterReveal(roundId) {
        Round storage r = rounds[roundId];
        require(!r.settled, "settled");
        require(hasPendingWinning[roundId], "no result");
        uint256 D = r.totalDeposits;

        // fees & base pools
        uint256 fee = (D * PCT_F) / PCT_DEN;
        platformFeesAccrued += fee;
        uint256 pool1 = (D * PCT_1) / PCT_DEN + r.carry1;
        uint256 pool2 = (D * PCT_2) / PCT_DEN;
        uint256 pool3 = (D * PCT_3) / PCT_DEN;

        uint16 w = uint16(pendingWinning[roundId]);
        uint256 tot1 = stakeByPick[roundId][w];

        // Determine closest and second-closest distances from winning number (excluding exact)
        uint16 min1 = type(uint16).max; // closest distance
        uint16 min2 = type(uint16).max; // second closest distance
        uint256 tot2 = 0; // total stake on closest picks
        uint256 tot3 = 0; // total stake on second closest picks

        for (uint16 p = 0; p <= RANGE_MAX; p++) {
            if (p == w) continue;
            uint256 s = stakeByPick[roundId][p];
            if (s == 0) continue;
            uint16 d = p > w ? (p - w) : (w - p);
            if (d < min1) {
                // shift current closest to second-closest
                min2 = min1;
                tot3 = tot2;
                min1 = d;
                tot2 = s;
            } else if (d == min1) {
                tot2 += s;
            } else if (d < min2) {
                min2 = d;
                tot3 = s;
            } else if (d == min2) {
                tot3 += s;
            }
        }

        UnitPayout storage up = unit[roundId];
        if (tot1 > 0) { up.exact = (pool1 * SCALE) / tot1; r.carry1 = 0; }
        else { up.exact = 0; r.carry1 = pool1; }
        up.last2 = (tot2 > 0) ? (pool2 * SCALE) / tot2 : 0;
        up.last1 = (tot3 > 0) ? (pool3 * SCALE) / tot3 : 0;

        r.winning = uint32(w);
        hasPendingWinning[roundId] = false;
        r.settled = true;
        emit Settled(roundId, pool1, pool2, pool3, fee);
    }

    function claim(uint256 roundId) external nonReentrant {
        Round memory r = rounds[roundId];
        require(r.settled, "not settled");
        UnitPayout memory up = unit[roundId];
        uint16 w = uint16(r.winning);
        // recompute closest and second-closest distances
        uint16 min1 = type(uint16).max;
        uint16 min2 = type(uint16).max;

        uint256 due;

        // exact
        uint256 sExact = userStakeByPick[roundId][msg.sender][w];
        if (sExact > 0 && up.exact > 0) due += (sExact * up.exact) / SCALE;

        // first compute min distances among picks with any stake in the round
        for (uint16 p = 0; p <= RANGE_MAX; p++) {
            if (p == w) continue;
            if (stakeByPick[roundId][p] == 0) continue;
            uint16 d = p > w ? (p - w) : (w - p);
            if (d < min1) {
                min2 = min1;
                min1 = d;
            } else if (d > min1 && d < min2) {
                min2 = d;
            }
        }

        // closest (2nd prize) – exclude exact
        if (up.last2 > 0) {
            for (uint16 p = 0; p <= RANGE_MAX; p++) {
                if (p == w) continue;
                uint16 d = p > w ? (p - w) : (w - p);
                if (d == min1) {
                    uint256 s = userStakeByPick[roundId][msg.sender][p];
                    if (s > 0) due += (s * up.last2) / SCALE;
                }
            }
        }
        // second closest (3rd prize)
        if (up.last1 > 0) {
            for (uint16 p2 = 0; p2 <= RANGE_MAX; p2++) {
                if (p2 == w) continue;
                uint16 d2 = p2 > w ? (p2 - w) : (w - p2);
                if (d2 == min2) {
                    uint256 s2 = userStakeByPick[roundId][msg.sender][p2];
                    if (s2 > 0) due += (s2 * up.last1) / SCALE;
                }
            }
        }

        uint256 already = claimed[roundId][msg.sender];
        require(due > already, "nothing");
        uint256 pay = due - already;
        claimed[roundId][msg.sender] = due;

        require(usdc.transfer(msg.sender, pay), "xfer");
        emit Claimed(roundId, msg.sender, pay);
    }

    /**
     * Anyone can trigger a user's payout after settlement.
     * This computes the due amount for `user` and transfers directly to `user`.
     * It mirrors `claim` but does not require the winner to send the transaction.
     */
    function claimFor(uint256 roundId, address user) external nonReentrant {
        require(user != address(0), "bad user");
        Round memory r = rounds[roundId];
        require(r.settled, "not settled");
        UnitPayout memory up = unit[roundId];
        uint16 w = uint16(r.winning);
        // recompute closest and second-closest distances
        uint16 min1 = type(uint16).max;
        uint16 min2 = type(uint16).max;

        uint256 due;

        // exact
        uint256 sExact = userStakeByPick[roundId][user][w];
        if (sExact > 0 && up.exact > 0) due += (sExact * up.exact) / SCALE;

        // first compute min distances among picks with any stake in the round
        for (uint16 p = 0; p <= RANGE_MAX; p++) {
            if (p == w) continue;
            if (stakeByPick[roundId][p] == 0) continue;
            uint16 d = p > w ? (p - w) : (w - p);
            if (d < min1) {
                min2 = min1;
                min1 = d;
            } else if (d > min1 && d < min2) {
                min2 = d;
            }
        }

        // closest (2nd prize) – exclude exact
        if (up.last2 > 0) {
            for (uint16 p2 = 0; p2 <= RANGE_MAX; p2++) {
                if (p2 == w) continue;
                uint16 d2 = p2 > w ? (p2 - w) : (w - p2);
                if (d2 == min1) {
                    uint256 s2 = userStakeByPick[roundId][user][p2];
                    if (s2 > 0) due += (s2 * up.last2) / SCALE;
                }
            }
        }
        // second closest (3rd prize)
        if (up.last1 > 0) {
            for (uint16 p3 = 0; p3 <= RANGE_MAX; p3++) {
                if (p3 == w) continue;
                uint16 d3 = p3 > w ? (p3 - w) : (w - p3);
                if (d3 == min2) {
                    uint256 s3 = userStakeByPick[roundId][user][p3];
                    if (s3 > 0) due += (s3 * up.last1) / SCALE;
                }
            }
        }

        uint256 already = claimed[roundId][user];
        require(due > already, "nothing");
        uint256 pay = due - already;
        claimed[roundId][user] = due;

        require(usdc.transfer(user, pay), "xfer");
        emit Claimed(roundId, user, pay);
    }

    function getMyPicks(uint256 roundId, address user) external view returns (uint16[] memory) {
        return userPicksIndex[roundId][user];
    }

    function getMyCommits(uint256 roundId, address user) external view returns (Commit[] memory) {
        return userCommits[roundId][user];
    }

    function getMyCommitCount(uint256 roundId, address user) external view returns (uint256) {
        return userCommits[roundId][user].length;
    }

    function generateCommitment(uint16 pick, uint256 nonce) external pure returns (bytes32) {
        return keccak256(abi.encodePacked(pick, nonce));
    }

    function withdrawFees(uint256 amount) external onlyOwner {
        if (amount == 0) amount = platformFeesAccrued;
        require(amount <= platformFeesAccrued, "exceeds");
        platformFeesAccrued -= amount;
        require(usdc.transfer(feeTreasury, amount), "xfer");
        emit FeesWithdrawn(amount, feeTreasury);
    }
}
