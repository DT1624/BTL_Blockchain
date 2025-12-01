const fs = require('fs');
const path = require('path');

const contracts = [
  'PredictionMarketDAO',
  'GovernanceToken'
];

const abiDir = path.join(__dirname, '../frontend/src/abis');

// Tạo folder nếu chưa có
if (!fs.existsSync(abiDir)) {
  fs.mkdirSync(abiDir, { recursive: true });
}

contracts.forEach(contractName => {
  const artifactPath = path.join(
    __dirname,
    `../artifacts/contracts/${contractName}.sol/${contractName}.json`
  );

  if (fs.existsSync(artifactPath)) {
    const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
    const abiPath = path.join(abiDir, `${contractName}.json`);
    
    fs.writeFileSync(
      abiPath,
      JSON.stringify(artifact.abi, null, 2)
    );
    
    console.log(`✅ Copied ${contractName} ABI to frontend/src/abis/`);
  } else {
    console.log(`❌ ${contractName} artifact not found. Run 'npx hardhat compile' first.`);
  }
});