// SPDX-License-Identifier: MIT
pragma solidity ^0.6.2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./Configurable.sol";
import "./Math.sol";
import "./IERC20Metadata.sol";

contract AnyPadPrivatePool is Configurable, ReentrancyGuard {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    address public currencyToken;
    address public sellingToken;
    uint256 public ratio;
    address payable public recipient;

    uint256 public purchaseTime;
    uint256 public withdrawTime;

    uint256 public totalAllocation;
    uint256 public totalPurchased;
    uint256 public totalClaimed;

    mapping(address => uint256) public allocationOf;
    mapping(address => uint256) public purchasedOf;
    mapping(address => uint256) public claimedOf;

    event AllocationAdded(address indexed user, uint256 amount, uint256 total);

    event Purchased(
        address indexed user,
        uint256 amount,
        uint256 volume,
        uint256 total
    );

    event Claimed(address indexed user, uint256 volume, uint256 total);

    event Withdrawn(address to, uint256 amount, uint256 volume);

    modifier poolInProgress() {
        require(
            block.timestamp >= purchaseTime,
            "ANYPAD: Pool has not started yet"
        );
        require(block.timestamp < withdrawTime, "ANYPAD: Pool expired");
        _;
    }

    function __AnyPadPrivatePool_init(
        address governor_,
        address currencyToken_,
        address sellingToken_,
        uint256 ratio_,
        address payable recipient_,
        uint256 purchaseTime_,
        uint256 withdrawTime_
    ) external initializer {
        require(
            sellingToken_ != address(0),
            "ANYPAD: sellingToken_ address cannot be 0"
        );
        require(
            sellingToken_ != currencyToken_,
            "ANYPAD: currency and selling token cannot be the same"
        );
        require(
            recipient_ != address(0),
            "ANYPAD: recipient_ address cannot be 0"
        );
        require(
            purchaseTime_ < withdrawTime_,
            "ANYPAD: purchaseTime_ should be before withdrawTime_"
        );
        __Governable_init_unchained(governor_);
        currencyToken = currencyToken_;
        sellingToken = sellingToken_;
        ratio = ratio_;
        recipient = recipient_;
        purchaseTime = purchaseTime_;
        withdrawTime = withdrawTime_;
    }

    receive() external payable {
        if (msg.value > 0) purchaseNative();
        else claim();
    }

    fallback() external {
        claim();
    }

    function setRecipient(address payable recipient_) external governance {
        require(
            recipient_ != address(0),
            "ANYPAD: recipient_ address cannot be 0"
        );
        recipient = recipient_;
    }

    function setAllocations(address[] calldata users, uint256 amount) external {
        for (uint256 i = 0; i < users.length; i++) {
            setAllocation(users[i], amount);
        }
    }

    function setAllocations(
        address[] calldata users,
        uint256[] calldata amounts
    ) external {
        require(
            users.length == amounts.length,
            "ANYPAD: users length must be the same as amounts length"
        );
        for (uint256 i = 0; i < users.length; i++) {
            setAllocation(users[i], amounts[i]);
        }
    }

    function setAllocation(address user, uint256 amount) public governance {
        totalAllocation = totalAllocation.add(amount).sub(allocationOf[user]);
        allocationOf[user] = amount;
        emit AllocationAdded(user, amount, totalAllocation);
    }

    function purchase(uint256 amount) external nonReentrant poolInProgress {
        require(
            address(currencyToken) != address(0),
            "ANYPAD: Should call purchaseNative() instead"
        );
        amount = Math.min(amount, allocationOf[msg.sender]);
        require(amount > 0, "ANYPAD: No allocation");
        require(
            IERC20(currencyToken).allowance(msg.sender, address(this)) >=
                amount,
            "ANYPAD: Not enough allowance"
        );
        require(
            IERC20(currencyToken).balanceOf(msg.sender) >= amount,
            "ANYPAD: Not enough balance"
        );
        require(purchasedOf[msg.sender] == 0, "ANYPAD: Already purchased");

        IERC20(currencyToken).safeTransferFrom(msg.sender, recipient, amount);

        uint256 decimals = IERC20Metadata(currencyToken).decimals();
        uint256 volume = amount.mul(ratio).div(10**decimals);
        purchasedOf[msg.sender] = volume;
        totalPurchased = totalPurchased.add(volume);
        require(
            totalPurchased <= IERC20(sellingToken).balanceOf(address(this)),
            "ANYPAD: Not enough tokens left to purchase"
        );
        emit Purchased(msg.sender, amount, volume, totalPurchased);
    }

    function purchaseNative() public payable nonReentrant poolInProgress {
        require(
            address(currencyToken) == address(0),
            "ANYPAD: Should call purchase(uint amount) instead"
        );
        uint256 amount = Math.min(msg.value, allocationOf[msg.sender]);
        require(amount > 0, "ANYPAD: No allocation");
        require(purchasedOf[msg.sender] == 0, "ANYPAD: Already purchased");

        recipient.transfer(amount);
        uint256 volume = amount.mul(ratio).div(1e18);
        purchasedOf[msg.sender] = volume;
        totalPurchased = totalPurchased.add(volume);
        require(
            totalPurchased <= IERC20(sellingToken).balanceOf(address(this)),
            "ANYPAD: Not enough tokens left to purchase"
        );
        if (msg.value > amount) {
            msg.sender.transfer(msg.value.sub(amount));
        }
        emit Purchased(msg.sender, amount, volume, totalPurchased);
    }

    function claim() public nonReentrant {
        require(
            block.timestamp >= withdrawTime,
            "ANYPAD: Claim phase has not started"
        );
        require(claimedOf[msg.sender] == 0, "ANYPAD: Already claimed");
        if (
            IERC20(sellingToken).balanceOf(address(this)).add(totalClaimed) >
            totalPurchased
        ) {
            IERC20(sellingToken).safeTransfer(
                recipient,
                IERC20(sellingToken)
                    .balanceOf(address(this))
                    .add(totalClaimed)
                    .sub(totalPurchased)
            );
        }
        uint256 volume = purchasedOf[msg.sender];
        claimedOf[msg.sender] = volume;
        totalClaimed = totalClaimed.add(volume);
        IERC20(sellingToken).safeTransfer(msg.sender, volume);
        emit Claimed(msg.sender, volume, totalClaimed);
    }

    function withdrawable()
        public
        view
        returns (uint256 amount_, uint256 volume_)
    {
        if (block.timestamp < withdrawTime) return (0, 0);
        if (currencyToken == address(0)) {
            amount_ = address(this).balance;
        } else {
            amount_ = IERC20(currencyToken).balanceOf(address(this));
        }
        volume_ = IERC20(sellingToken)
        .balanceOf(address(this))
        .add(totalClaimed)
        .sub(totalPurchased);
    }

    function withdraw(
        address payable to,
        uint256 amount,
        uint256 volume
    ) external governance nonReentrant {
        require(block.timestamp >= withdrawTime, "ANYPAD: Pool is incomplete");
        (uint256 amount_, uint256 volume_) = withdrawable();
        amount = Math.min(amount, amount_);
        volume = Math.min(volume, volume_);
        if (currencyToken == address(0)) {
            to.transfer(amount);
        } else {
            IERC20(currencyToken).safeTransfer(to, amount);
        }
        IERC20(sellingToken).safeTransfer(to, volume);
        emit Withdrawn(to, amount, volume);
    }
}
