const hre = require("hardhat");
const { ethers } = hre;

async function main() {
  // Deploy mock USDC first
  console.log("Deploying Mock USDC...");
  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const mockUsdc = await MockUSDC.deploy();
  await mockUsdc.waitForDeployment();
  const usdcAddress = await mockUsdc.getAddress();
  console.log("Mock USDC deployed to:", usdcAddress);

  // Deploy VRF Mock
  console.log("Deploying VRF Mock...");
  const VRFMock = await ethers.getContractFactory("VRFMock");
  const vrfMock = await VRFMock.deploy();
  await vrfMock.waitForDeployment();
  const vrfAddress = await vrfMock.getAddress();
  console.log("VRF Mock deployed to:", vrfAddress);

  // Get signers
  const [deployer] = await ethers.getSigners();
  const treasury = deployer.address;
  
  // Deploy BlockLotto with mock values
  console.log("Deploying BlockLotto...");
  const Lotto = await ethers.getContractFactory("BlockLotto");
  const lotto = await Lotto.deploy(usdcAddress, treasury);
  await lotto.waitForDeployment();
  const lottoAddress = await lotto.getAddress();
  console.log("BlockLotto deployed to:", lottoAddress);

  // Set VRF with mock values
  const keyHash = "0x" + "1".repeat(64); // Mock key hash (32 bytes of 1s)
  const subId = 1; // Mock subscription ID
  console.log("Configuring VRF...");
  const tx = await lotto.setVRF(vrfAddress, keyHash, subId);
  await tx.wait();
  console.log("VRF configured");

  // Create a round
  const now = Math.floor(Date.now() / 1000);
  const open = now + 60; // 1 minute from now
  const close = open + 20 * 60 * 60; // 20 hours commit phase
  const reveal = close + 4 * 60 * 60; // 4 hours reveal phase
  console.log("Creating round...");
  const tx2 = await lotto.createRound(open, close, reveal);
  await tx2.wait();
  console.log("Round #", (await lotto.currentRoundId()).toString(), "created");

  // Mint some USDC to the deployer for testing
  console.log("Minting test USDC...");
  const mintAmount = ethers.parseUnits("1000", 6); // 1000 USDC
  await mockUsdc.mint(deployer.address, mintAmount);
  console.log("Minted", ethers.formatUnits(mintAmount, 6), "USDC to", deployer.address);
  
  // Approve USDC for BlockLotto
  console.log("Approving USDC for BlockLotto...");
  await mockUsdc.approve(lottoAddress, mintAmount);
  console.log("USDC approved for BlockLotto");

  console.log("\nDeployment Summary:");
  console.log("------------------");
  console.log("Mock USDC:", usdcAddress);
  console.log("VRF Mock:", vrfAddress);
  console.log("BlockLotto:", lottoAddress);
  console.log("Treasury:", treasury);
}

main().catch((e) => { 
  console.error(e); 
  process.exit(1); 
});