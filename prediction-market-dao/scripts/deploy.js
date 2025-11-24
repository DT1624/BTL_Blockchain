const hre = require("hardhat");

async function main() {
  // Lấy contract factory
  const PMDAO = await hre.ethers.getContractFactory("PredictionMarketDAO");

  // Deploy với arguments (1000 GOV token)
  const pmdao = await PMDAO.deploy(1000);

  // Chờ deploy xong
  await pmdao.waitForDeployment();  // <-- dùng waitForDeployment() thay vì .deployed()

  console.log("PredictionMarketDAO deployed to:", await pmdao.getAddress());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
