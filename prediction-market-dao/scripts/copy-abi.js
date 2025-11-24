const fs = require("fs");
const path = require("path");

// Đường dẫn file artifact Hardhat
const artifactPath = path.join(
  __dirname,
  "../artifacts/contracts/PredictionMarketDAO.sol/PredictionMarketDAO.json"
);

// Đường dẫn file frontend muốn copy
const destPath = path.join(
  __dirname,
  "../prediction-market-frontend/src/PredictionMarketDAO.json"
);

// Đọc artifact
const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));

// Lấy chỉ phần ABI
const abi = artifact.abi;

// Ghi ra frontend
fs.writeFileSync(destPath, JSON.stringify(abi, null, 2));

console.log(`✅ ABI đã được copy vào ${destPath}`);
