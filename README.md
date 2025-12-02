<h1 align="center"> Decentralized Prediction Market DAO </h1>
<p align="center"> A Web3 platform for decentralized forecasting, asset management, and community governance built on a Component-based Architecture. </p>

## 📖 Table of Contents

- [⭐ Overview](#-overview)
- [✨ Key Features](#-key-features)
- [🛠️ Tech Stack & Architecture](#-tech-stack--architecture)
- [📁 Project Structure](#-project-structure)
- [🚀 Getting Started](#-getting-started)
- [🔧 Usage](#-usage)
- [🤝 Contributing](#-contributing)
- [📝 License](#-license)

---

## ⭐ Overview

A decentralized prediction market built with Hardhat and React, allowing users to create markets, trade outcome tokens, close markets, claim rewards, and use GOV tokens for governance actions.

### The Problem

> Traditional prediction markets face centralization, opaque management, and high fees, limiting trust and true community governance. Decentralized projects often struggle with fair, transparent, and enforceable governance, leaving users without reliable, censorship-resistant control over markets and platform evolution.

### The Solution

This platform integrates Governance Tokens and a Prediction Market DAO to ensure decentralized control. A React-based interface combined with ethers allows secure, seamless interactions with smart contracts. Users can create markets, trade shares, and vote on proposals, all within a fully transparent DApp that prioritizes UX without compromising decentralization.

### Architecture Overview
Built on a Component-based Architecture with React, the frontend cleanly separates UI from smart contract logic, enabling reusable components, efficient state management, and dynamic presentation of complex DAO and market functions.

---

## 📁 Project Structure

The project follows a standard DApp structure, separating the blockchain contracts and deployment logic from the user-facing React application. This hierarchy ensures modularity and clarity across the development lifecycle.

```
Decentralized-Prediction-Market-DAO/
├── 📄 README.md                 # Project documentation
└── 📂 prediction-market-dao/
    ├── 📄 package-lock.json
    ├── 📄 hardhat.config.js       # Hardhat configuration file
    ├── 📄 package.json            # Main project dependencies (development and testing)
    ├── 📄 .gitignore
    ├── 📂 frontend/               # React-based user interface application entry
    │   ├── 📄 eslint.config.js
    │   ├── 📄 package-lock.json
    │   ├── 📄 README.md
    │   ├── 📄 package.json
    │   ├── 📄 index.html
    │   ├── 📄 .gitignore
    │   ├── 📄 vite.config.js      # Frontend build tool configuration
    │   ├── 📄 .env                # Local environment variables for frontend configuration
    │   ├── 📂 src/
    │   │   ├── 📄 index.css
    │   │   ├── 📄 main.jsx        # Frontend application initialization script
    │   │   ├── 📄 App.css
    │   │   ├── 📄 index.jsx
    │   │   ├── 📄 App.jsx         # Root React component wrapper
    │   │   ├── 📂 abis/           # Compiled Application Binary Interfaces (JSON definitions)
    │   │   │   ├── 📄 GovernanceToken.json
    │   │   │   └── 📄 PredictionMarketDAO.json
    │   │   ├── 📂 utils/
    │   │   │   └── 📄 contract.js # Web3 integration utilities and contract instantiation logic
    │   │   ├── 📂 assets/
    │   │   │   └── 📄 react.svg
    │   │   └── 📂 components/     # Reusable UI components for the DApp
    │   │       ├── 📄 MarketCard.jsx      # Summary view for a single market
    │   │       ├── 📄 MarketDetail.jsx    # Detailed view and interaction for a market
    │   │       ├── 📄 Header.jsx          # Application navigation header
    │   │       ├── 📄 ProposalDetail.jsx  # Detailed view for a governance proposal
    │   │       ├── 📄 TabProposals.jsx    # Tab view listing all active/past proposals
    │   │       ├── 📄 AdminPanel.jsx      # Restricted panel for administrative functions
    │   │       ├── 📄 TabMarkets.jsx      # Tab view listing all active/past markets
    │   │       ├── 📄 ProposalCard.jsx    # Summary view for a single proposal
    │   │       └── 📄 TabGovToken.jsx     # Tab view for governance token management
    │   └── 📂 public/
    │       ├── 📄 vite.svg
    │       └── 📄 index.html
    ├── 📂 test/                   # Smart contract unit tests
    │   ├── 📄 governanceToken.test.js
    │   └── 📄 predictionMarketDAO.test.js
    ├── 📂 scripts/                # Utility scripts for development and deployment
    │   ├── 📄 copy-abi.js         # Copies compiled contract ABIs to the frontend/src/abis directory
    │   ├── 📄 deploy.js           # Script for standard contract deployment
    │   └── 📄 deploy-and-setup.js # Script to deploy both contracts and perform initial setup steps
    └── 📂 contracts/              # Solidity source code for the core smart contracts
        ├── 📄 GovernanceToken.sol
        └── 📄 PredictionMarketDAO.sol
```

---

## 🚀 Getting Started

As this project is an interactive web application (`web_app`) that integrates a React frontend with underlying smart contracts, the primary setup steps involve preparing the environment to run the user interface and interact with the contracts.

### Prerequisites

To run and develop this application, you will need the following tools installed:

*   **Node.js:** (LTS version recommended)
*   **npm:** (Node Package Manager, typically installed with Node.js)

### Installation

Follow these steps to set up the necessary environment and install dependencies for the React frontend:

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/DT1624/BTL_Blockchain.git
    cd BTL_Blockchain/prediction-market-dao/
    ```

2.  **Install Dependencies:**

    ```bash
    npm install
    npm init

    # Install hardhat
    npm install --save-dev hardhat@2.27.0

    # Init hardhat
    npx hardhat init

    # Install plugin 
    npm install --save-dev @nomicfoundation/hardhat-toolbox

    npm install @openzeppelin/contracts
    # ORl
    ```
3.  **Compile, test and deploy contracts:**
    ```bash
    npx hardhat compile

    npx hardhat test

    # Copy ABI to frontend/abis
    npm run copy-abis

    npx hardhat node

    npx hardhat run scripts/deploy-and-setup.js --network localhost
    ```
---

## 🔧 Usage
### Running the Interactive User Interface
1.  **Ensure you are in the `frontend` directory:**
    ```bash
    cd frontend
    npm install
    npm install ethers
    ```

2.  **Start the development server:**
    ```bash
    npm run dev
    ```

3.  **Access the Application:**
    Open your web browser and navigate to the local address provided by the terminal (typically `http://localhost:5173`).

### Interacting with the DApp

Once the application is loaded, interactions are component-driven, leveraging the verified UI components:

| Component | User Action / Outcome |
| :--- | :--- |
| **Header** (`Header.jsx`) | Navigation between core sections (Markets, Governance, Admin) and connecting a Web3 wallet (required for all transactions). |
| **Markets Tab** (`TabMarkets.jsx`) | Browsing a list of all active or resolved prediction markets. |
| **Market Detail** (`MarketDetail.jsx`) | Buying shares, selling shares, viewing the market resolution status, and reviewing detailed market data. |
| **Proposals Tab** (`TabProposals.jsx`) | Viewing community-submitted proposals and the current state of governance. |
| **Proposal Detail** (`ProposalDetail.jsx`) | Casting votes using held governance tokens and reviewing the proposal's voting history. |
| **Governance Token Tab** (`TabGovToken.jsx`) | Monitoring token balances, claiming rewards, or viewing token distribution data. |
| **Admin Panel** (`AdminPanel.jsx`) | Performing privileged functions, accessible only to designated administrators or DAO-controlled multisigs. |

---