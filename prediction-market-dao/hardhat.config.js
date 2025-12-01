require("@nomicfoundation/hardhat-toolbox");

module.exports = {
  solidity: {
    version: "0.8.20", // hoặc version bạn dùng
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      },
      viaIR: true
    }
  },
  networks: {
    hardhat: {}, // local development
    localhost: {
      url: "http://127.0.0.1:8545"
    }
  }
};
