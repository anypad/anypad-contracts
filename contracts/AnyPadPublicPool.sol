// SPDX-License-Identifier: MIT
pragma solidity ^0.6.2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "./Configurable.sol";
import "./Math.sol";

contract AnyPadPublicPool is Configurable {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;
    using Address for address payable;

    address public currencyToken;
    address public underlyingToken;

    uint256 public purchaseDeadline;
    uint256 public settleTime;

    uint256 public price;
    uint256 public settleRate;
    // Each user is allowed to buy with
    // a max currency amount of this value
    uint256 public maxAllocation;

    bool public completed;

    uint256 public totalPurchasedCurrency;
    uint256 public totalSettledUnderlying;
    uint256 public totalSettledCurrency;

    mapping(address => uint256) public purchasedCurrencyOf;
    mapping(address => uint256) public settledUnderlyingOf;
    mapping(address => uint256) public settledCurrencyOf;

    event Purchased(
        address indexed acct,
        uint256 amount,
        uint256 totalCurrency
    );

    event Settled(
        address indexed acct,
        uint256 refundAmount,
        uint256 volume,
        uint256 rate
    );

    event Withdrawn(address to, uint256 amount, uint256 volume);

    modifier poolInProgress() {
        require(block.timestamp < purchaseDeadline, "ANYPAD: Pool expired");
        _;
    }

    modifier maxAllocationNotReached(uint256 amount) {
        require(
            purchasedCurrencyOf[msg.sender].add(amount) <= maxAllocation,
            "ANYPAD: Buying more than allowed"
        );
        _;
    }

    function __AnyPadPublicPool_init(
        address governor_,
        address currencyToken_,
        address underlyingToken_,
        uint256 price_,
        uint256 maxAllocation_,
        uint256 purchaseDeadline_,
        uint256 settleTime_
    ) external initializer {
        require(
            settleTime_ >= purchaseDeadline_,
            "ANYPAD: Settle time should be after purchase deadline"
        );
        require(
            underlyingToken_ != address(0),
            "ANYPAD: Invalid underlying token"
        );
        __Governable_init_unchained(governor_);
        currencyToken = currencyToken_;
        underlyingToken = underlyingToken_;
        price = price_;
        maxAllocation = maxAllocation_;
        purchaseDeadline = purchaseDeadline_;
        settleTime = settleTime_;
    }

    receive() external payable {
        if (msg.value > 0) purchaseNative();
        else settle();
    }

    fallback() external {
        settle();
    }

    function setMaxAllocation(uint256 _maxAllocation) external governance {
        maxAllocation = _maxAllocation;
    }

    // function setDate(uint256 _purchaseDeadline, uint256 _settleTime)
    //     external
    //     governance
    // {
    //     require(
    //         _settleTime >= _purchaseDeadline,
    //         "ANYPAD: settle time should be after purchase deadline"
    //     );
    //     purchaseDeadline = _purchaseDeadline;
    //     settleTime = _settleTime;
    // }

    function purchase(uint256 amount)
        external
        poolInProgress
        maxAllocationNotReached(amount)
    {
        require(
            address(currencyToken) != address(0),
            "ANYPAD: Should call purchaseNative() instead"
        );
        require(
            IERC20(currencyToken).allowance(msg.sender, address(this)) >=
                amount,
            "ANYPAD: Not enough allowance"
        );
        require(
            IERC20(currencyToken).balanceOf(msg.sender) >= amount,
            "ANYPAD: Not enough balance"
        );
        IERC20(currencyToken).safeTransferFrom(
            msg.sender,
            address(this),
            amount
        );
        purchasedCurrencyOf[msg.sender] = purchasedCurrencyOf[msg.sender].add(
            amount
        );
        totalPurchasedCurrency = totalPurchasedCurrency.add(amount);
        emit Purchased(msg.sender, amount, totalPurchasedCurrency);
    }

    function purchaseNative()
        public
        payable
        poolInProgress
        maxAllocationNotReached(msg.value)
    {
        require(
            address(currencyToken) == address(0),
            "ANYPAD: Should call purchase(uint256 amount) instead"
        );
        uint256 amount = msg.value;
        purchasedCurrencyOf[msg.sender] = purchasedCurrencyOf[msg.sender].add(
            amount
        );
        totalPurchasedCurrency = totalPurchasedCurrency.add(amount);
        emit Purchased(msg.sender, amount, totalPurchasedCurrency);
    }

    function totalSettleable()
        public
        view
        returns (
            bool completed_,
            uint256 amount,
            uint256 volume,
            uint256 rate
        )
    {
        return settleable(address(0));
    }

    function settleable(address acct)
        public
        view
        returns (
            bool completed_,
            uint256 refundAmount,
            uint256 volume,
            uint256 rate
        )
    {
        completed_ = completed;
        if (completed_) {
            rate = settleRate;
        } else {
            uint256 totalCurrency = currencyToken == address(0)
                ? address(this).balance
                : IERC20(currencyToken).balanceOf(address(this));
            uint256 totalUnderlying = IERC20(underlyingToken).balanceOf(
                address(this)
            );
            if (totalUnderlying.mul(price) < totalCurrency.mul(1e18)) {
                // Received more currency tokens than expected. Calculate
                // the percentage of the deposited currency that each user
                // is allowed to purchase underlying tokens
                rate = totalUnderlying.mul(price).div(totalCurrency);
            } else {
                // Allow purchasing with 100% amount of deposited currency
                rate = 1e18;
            }
        }
        uint256 purchasedCurrency = acct == address(0)
            ? totalPurchasedCurrency
            : purchasedCurrencyOf[acct];
        // Actual amount of currency tokens that can be used to purchase underlying tokens
        uint256 settleAmount = purchasedCurrency.mul(rate).div(1e18);
        // Calculate the number of currency tokens that will be refunded to the caller
        refundAmount = purchasedCurrency.sub(settleAmount).sub(
            acct == address(0) ? totalSettledCurrency : settledCurrencyOf[acct]
        );
        // Actual amount of underlying tokens that the caller can purchase
        volume = settleAmount.mul(1e18).div(price).sub(
            acct == address(0)
                ? totalSettledUnderlying
                : settledUnderlyingOf[acct]
        );
    }

    function settle() public {
        require(
            block.timestamp >= purchaseDeadline,
            "ANYPAD: Can't settle before purchase deadline"
        );
        require(
            settledUnderlyingOf[msg.sender] == 0 ||
                settledCurrencyOf[msg.sender] == 0,
            "ANYPAD: Already settled"
        );
        (
            bool completed_,
            uint256 refundAmount,
            uint256 volume,
            uint256 rate
        ) = settleable(msg.sender);
        if (!completed_) {
            completed = true;
            settleRate = rate;
        }
        settledCurrencyOf[msg.sender] = settledCurrencyOf[msg.sender].add(
            refundAmount
        );
        totalSettledCurrency = totalSettledCurrency.add(refundAmount);
        require(
            refundAmount > 0 || block.timestamp >= settleTime,
            "ANYPAD: It is not time to settle underlying"
        );
        if (block.timestamp >= settleTime) {
            settledUnderlyingOf[msg.sender] = settledUnderlyingOf[msg.sender].add(volume);
            totalSettledUnderlying = totalSettledUnderlying.add(volume);
            IERC20(underlyingToken).safeTransfer(msg.sender, volume);
        }
        if (currencyToken == address(0)) {
            payable(msg.sender).sendValue(refundAmount);
        } else {
            IERC20(currencyToken).safeTransfer(msg.sender, refundAmount);
        }
        emit Settled(msg.sender, refundAmount, volume, rate);
    }

    function withdrawable()
        public
        view
        returns (uint256 amount_, uint256 volume_)
    {
        if (!completed) return (0, 0);
        amount_ = totalPurchasedCurrency.mul(settleRate).div(1e18);
        volume_ = IERC20(underlyingToken)
                    .balanceOf(address(this))
                    .add(totalSettledUnderlying)
                    .sub(totalPurchasedCurrency.mul(settleRate).div(price));
    }

    function withdraw(
        address payable to,
        uint256 amount,
        uint256 volume
    ) external governance {
        require(completed, "ANYPAD: Pool is incomplete");
        (uint256 amount_, uint256 volume_) = withdrawable();
        amount = Math.min(amount, amount_);
        volume = Math.min(volume, volume_);
        if (currencyToken == address(0)) {
            to.sendValue(amount);
        } else {
            IERC20(currencyToken).safeTransfer(to, amount);
        }
        IERC20(underlyingToken).safeTransfer(to, volume);
        emit Withdrawn(to, amount, volume);
    }
}
