// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// contract GovernanceToken is ERC20 {
//     string public name = "Governance Token";
//     string public symbol = "GOV";

//     constructor(uint256 initialSupply) ERC20("Governance Token", "GOV") {
//         _mint(msg.sender, initialSupply);
//     }
// }
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

contract GovernanceToken is ERC20, ERC20Votes, ERC20Permit {
    constructor(
        uint256 initialSupply
    ) ERC20("GovToken", "GOV") ERC20Votes() ERC20Permit("GovToken") {
        _mint(msg.sender, initialSupply);
    }

    // The following functions are overrides required by Solidity.

    function _update(address from, address to, uint256 amount)
        internal
        override(ERC20, ERC20Votes)
    {
        super._update(from, to, amount);
    }

    function nonces(address owner)
        public
        view
        override(ERC20Permit, Nonces)
        returns (uint256)
    {
        return super.nonces(owner);
    }
}
