// SPDX-License-Identifier: MIT
pragma solidity ^0.6.2;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    constructor(string memory name_, string memory symbol_)
        public
        ERC20(name_, symbol_)
    {
        _mint(msg.sender, 1000000 * 10**18);
    }
}
