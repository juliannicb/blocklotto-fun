// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

interface IVRFConsumer {
    function rawFulfillRandomWords(uint256 requestId, uint256[] calldata randomWords) external;
}

/**
 * VRFMock:
 * - requestRandomWords(...) returns an incrementing requestId
 * - fulfill(consumer, requestId, rnd) simulates the callback to the consumer
 */
contract VRFMock {
    uint256 public nextRequestId = 1;

    function requestRandomWords(
        bytes32, uint256, uint16, uint32, uint32
    ) external returns (uint256 requestId) {
        requestId = nextRequestId;
        nextRequestId += 1;
    }

    function fulfill(address consumer, uint256 requestId, uint256 rnd) external {
        // ✅ CORRECT: Declare and initialize the array properly
        uint256[] memory words = new uint256[](1);
        words[0] = rnd;
        IVRFConsumer(consumer).rawFulfillRandomWords(requestId, words);
    }
}
