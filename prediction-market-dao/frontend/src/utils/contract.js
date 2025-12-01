import { ethers } from 'ethers';

import DAO_ARTIFACT from "../abis/PredictionMarketDAO.json";
import GOV_ARTIFACT from "../abis/GovernanceToken.json";

const DAO_ADDRESS = import.meta.env.VITE_DAO_ADDRESS;
const GOV_ADDRESS = import.meta.env.VITE_GOV_ADDRESS;
const DAO_ABI = DAO_ARTIFACT;
const GOV_ABI = GOV_ARTIFACT;

export const getContracts = async (signer) => {
  // console.log("DAO ABI:", DAO_ABI);
  // console.log("GOV ABI:", GOV_ABI);
  try {
    const network = await signer.provider.getNetwork();
    const networkName = network.chainId === 31337n ? 'localhost' : 'unknown';

    const daoContract = new ethers.Contract(
      DAO_ADDRESS,
      DAO_ABI,
      signer
    );

    // Get GOV token address from DAO

    const govTokenContract = new ethers.Contract(
      GOV_ADDRESS,
      GOV_ABI,
      signer
    );

    return { daoContract, govTokenContract };
  } catch (error) {
    console.error('Get contracts error:', error);
    throw error;
  }
};