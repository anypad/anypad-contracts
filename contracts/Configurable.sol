// SPDX-License-Identifier: MIT
pragma solidity ^0.6.2;

import "@openzeppelin/contracts-upgradeable/proxy/Initializable.sol";

contract Governable is Initializable {
    address public governor;

    event GovernorshipTransferred(
        address indexed previousGovernor,
        address indexed newGovernor
    );

    /**
     * @dev Contract initializer.
     * called once by the factory at time of deployment
     */
    function __Governable_init_unchained(address governor_)
        public
        virtual
        initializer
    {
        governor = governor_;
        emit GovernorshipTransferred(address(0), governor);
    }

    modifier governance() {
        require(msg.sender == governor);
        _;
    }

    /**
     * @dev Allows the current governor to relinquish control of the contract.
     * @notice Renouncing to governorship will leave the contract without an governor.
     * It will not be possible to call the functions with the `governance`
     * modifier anymore.
     */
    function renounceGovernorship() public governance {
        emit GovernorshipTransferred(governor, address(0));
        governor = address(0);
    }

    /**
     * @dev Allows the current governor to transfer control of the contract to a newGovernor.
     * @param newGovernor The address to transfer governorship to.
     */
    function transferGovernorship(address newGovernor) public governance {
        _transferGovernorship(newGovernor);
    }

    /**
     * @dev Transfers control of the contract to a newGovernor.
     * @param newGovernor The address to transfer governorship to.
     */
    function _transferGovernorship(address newGovernor) internal {
        require(newGovernor != address(0));
        emit GovernorshipTransferred(governor, newGovernor);
        governor = newGovernor;
    }
}

contract Configurable is Governable {
    mapping(bytes32 => uint256) internal config;

    function getConfig(bytes32 key) public view returns (uint256) {
        return config[key];
    }

    function getConfig(bytes32 key, uint256 index)
        public
        view
        returns (uint256)
    {
        return config[bytes32(uint256(key) ^ index)];
    }

    function getConfig(bytes32 key, address addr)
        public
        view
        returns (uint256)
    {
        return config[bytes32(uint256(key) ^ uint256(addr))];
    }

    function _setConfig(bytes32 key, uint256 value) internal {
        if (config[key] != value) config[key] = value;
    }

    function _setConfig(
        bytes32 key,
        uint256 index,
        uint256 value
    ) internal {
        _setConfig(bytes32(uint256(key) ^ index), value);
    }

    function _setConfig(
        bytes32 key,
        address addr,
        uint256 value
    ) internal {
        _setConfig(bytes32(uint256(key) ^ uint256(addr)), value);
    }

    function setConfig(bytes32 key, uint256 value) external governance {
        _setConfig(key, value);
    }

    function setConfig(
        bytes32 key,
        uint256 index,
        uint256 value
    ) external governance {
        _setConfig(bytes32(uint256(key) ^ index), value);
    }

    function setConfig(
        bytes32 key,
        address addr,
        uint256 value
    ) public governance {
        _setConfig(bytes32(uint256(key) ^ uint256(addr)), value);
    }
}
