const { constants, time } = require('@openzeppelin/test-helpers');
const { expect } = require('chai');
const hre = require('hardhat');
const { ethers } = require('hardhat');
const { parseEther } = hre.ethers.utils;

const DEFAULT_PRICE = parseEther('0.001');
const DEFAULT_MAX_ALLOCATION = parseEther('1');
const TOTAL_VOLUME = parseEther('100');

describe('AnyPadPublicPool', async function () {
  let pool;
  let token;
  let currencyToken;
  let governance;
  let alice;
  let bob;

  const currencyNative = constants.ZERO_ADDRESS;

  const defaultAddress = () => ({
    governance: governance,
    token: token,
    currency: currencyNative,
    pool: pool,
  });

  const createPool = async({
    pool,
    governance,
    currency,
    token,
    totalVolume = TOTAL_VOLUME,
    price = DEFAULT_PRICE,
    maxAllocation = DEFAULT_MAX_ALLOCATION,
    currentTime,
    purchaseDeadlineFromCurrent = 1000,
    settleTimeFromPurchase = 1000,
  }) => {
    currentTime = currentTime
      ? currentTime
      : Math.round(await time.latest());
    const purchaseDeadline = currentTime + purchaseDeadlineFromCurrent;
    const settleTime = purchaseDeadline + settleTimeFromPurchase;

    await pool.__AnyPadPublicPool_init(
      governance.address,
      currency,
      token.address,
      price,
      maxAllocation,
      purchaseDeadline,
      settleTime,
    );

    await token.connect(governance).transfer(pool.address, totalVolume);
  }

  const giveCurrencyToken = async (toAddress, amount) => {
    await currencyToken.connect(governance).transfer(toAddress, amount);
  }

  
  beforeEach(async function () {
    const Token = await ethers.getContractFactory('MockERC20');
    const Pool = await ethers.getContractFactory('AnyPadPublicPool');

    [governance, alice, bob, ] = await ethers.getSigners();

    token = await Token.deploy('UNDERLYING', 'UDL');
    currencyToken = await Token.deploy('CURRENCY', 'CRC');
    pool = await Pool.deploy();
  });

  it('properly initialize', async function () {
    const currentTime = Math.round(await time.latest());
    await createPool({
      currentTime: currentTime,
      ...defaultAddress(),
    });

    expect(await pool.governor()).to.equal(governance.address);
    expect(await pool.currencyToken()).to.equal(currencyNative);
    expect(await pool.underlyingToken()).to.equal(token.address);
    expect(await pool.price()).to.equal(DEFAULT_PRICE);
    expect(await pool.maxAllocation()).to.equal(DEFAULT_MAX_ALLOCATION);
    expect(await pool.purchaseDeadline()).to.equal(currentTime + 1000);
    expect(await pool.settleTime()).to.equal(currentTime + 2000);
  });

  it('throw when invalid date supplied', async function () {
    await expect(createPool({
      purchaseDeadlineFromCurrent: 1000,
      settleTimeFromPurchase: -1000,
      ...defaultAddress(),
    })).to.be.revertedWith('ANYPAD: Settle time should be after purchase deadline');
  });

  it('throw when underlying token is zero', async function () {
    await expect(createPool({
      ...defaultAddress(),
      token: { address: constants.ZERO_ADDRESS },
    })).to.be.revertedWith('ANYPAD: Invalid underlying token');
  });

  it('owner can change max allocation', async function () {
    await createPool({
      ...defaultAddress(),
    });

    expect(await pool.maxAllocation()).to.equal(DEFAULT_MAX_ALLOCATION);
    await pool.connect(governance).setMaxAllocation(parseEther('10'));
    expect(await pool.maxAllocation()).to.equal(parseEther('10'));
  });

  it('allow users to purchase', async function () {
    await createPool({
      ...defaultAddress(),
      currency: currencyToken.address,
    });

    await giveCurrencyToken(alice.address, DEFAULT_MAX_ALLOCATION);
    await currencyToken.connect(alice).approve(pool.address, DEFAULT_MAX_ALLOCATION);
    await pool.connect(alice).purchase(DEFAULT_MAX_ALLOCATION);
    expect(await pool.purchasedCurrencyOf(alice.address)).to.equal(DEFAULT_MAX_ALLOCATION);
    expect(await pool.totalPurchasedCurrency()).to.equal(DEFAULT_MAX_ALLOCATION);
    expect(await currencyToken.balanceOf(pool.address)).to.equal(DEFAULT_MAX_ALLOCATION);

    await giveCurrencyToken(bob.address, DEFAULT_MAX_ALLOCATION);
    await currencyToken.connect(bob).approve(pool.address, DEFAULT_MAX_ALLOCATION);
    await pool.connect(bob).purchase(DEFAULT_MAX_ALLOCATION);
    expect(await pool.purchasedCurrencyOf(bob.address)).to.equal(DEFAULT_MAX_ALLOCATION);
    expect(await pool.totalPurchasedCurrency()).to.equal(parseEther('2'));
    expect(await currencyToken.balanceOf(pool.address)).to.equal(parseEther('2'));

  });

  it('allow incremental purchase', async function () {
    await createPool({
      ...defaultAddress(),
      currency: currencyToken.address,
    });

    const half = parseEther('0.5');
    await giveCurrencyToken(alice.address, DEFAULT_MAX_ALLOCATION);
    await currencyToken.connect(alice).approve(pool.address, DEFAULT_MAX_ALLOCATION);
    await pool.connect(alice).purchase(half);
    expect(await pool.purchasedCurrencyOf(alice.address)).to.equal(half);
    await pool.connect(alice).purchase(half);
    expect(await pool.purchasedCurrencyOf(alice.address)).to.equal(DEFAULT_MAX_ALLOCATION);
  });

  it('cannot call purchase if currency is native', async function () {
    await createPool({
      ...defaultAddress(),
    });

    await giveCurrencyToken(alice.address, DEFAULT_MAX_ALLOCATION);
    await currencyToken.connect(alice).approve(pool.address, DEFAULT_MAX_ALLOCATION);
    await expect(pool.connect(alice).purchase(DEFAULT_MAX_ALLOCATION)).to.be.revertedWith('ANYPAD: Should call purchaseNative() instead');
  });


  it('cannot call purchase if not enough allowance', async function () {
    await createPool({
      ...defaultAddress(),
      currency: currencyToken.address,
    });

    await giveCurrencyToken(alice.address, DEFAULT_MAX_ALLOCATION);
    await expect(pool.connect(alice).purchase(DEFAULT_MAX_ALLOCATION)).to.be.revertedWith('ANYPAD: Not enough allowance');
  });

  it('cannot call purchase if not enough balance', async function () {
    await createPool({
      ...defaultAddress(),
      currency: currencyToken.address,
    });

    await currencyToken.connect(alice).approve(pool.address, DEFAULT_MAX_ALLOCATION);
    await expect(pool.connect(alice).purchase(DEFAULT_MAX_ALLOCATION)).to.be.revertedWith('ANYPAD: Not enough balance');
  });

  it('cannot purchase more than max allocation', async function () {
    await createPool({
      ...defaultAddress(),
      currency: currencyToken.address,
    });

    await giveCurrencyToken(alice.address, parseEther('2'));
    await currencyToken.connect(alice).approve(pool.address, parseEther('2'));
    await pool.connect(alice).purchase(parseEther('0.5'));
    
    // over allocation
    await expect(pool.connect(alice).purchase(DEFAULT_MAX_ALLOCATION)).to.be.revertedWith('ANYPAD: Buying more than allowed');

    // under allocation
    await pool.connect(alice).purchase(parseEther('0.2'));

    expect(await pool.purchasedCurrencyOf(alice.address)).to.equal(parseEther('0.7'));
  });

  it('cannot purchase after purchase deadline has passed', async function () {
    await createPool({
      ...defaultAddress(),
      currency: currencyToken.address,
    });
    await time.increase('1000');

    await giveCurrencyToken(alice.address, DEFAULT_MAX_ALLOCATION);
    await currencyToken.connect(alice).approve(pool.address, DEFAULT_MAX_ALLOCATION);
    await expect(pool.connect(alice).purchase(DEFAULT_MAX_ALLOCATION)).to.be.revertedWith('ANYPAD: Pool expired');

  });

  it('can purchase with native currency', async function () {
    await createPool({
      ...defaultAddress(),
    });

    await pool.connect(alice).purchaseNative({ value: DEFAULT_MAX_ALLOCATION });
    expect(await pool.purchasedCurrencyOf(alice.address)).to.equal(DEFAULT_MAX_ALLOCATION);
    expect(await pool.totalPurchasedCurrency()).to.equal(DEFAULT_MAX_ALLOCATION);
    expect(await ethers.provider.getBalance(pool.address)).to.equal(DEFAULT_MAX_ALLOCATION);

    await pool.connect(bob).purchaseNative({ value: DEFAULT_MAX_ALLOCATION });
    expect(await pool.purchasedCurrencyOf(bob.address)).to.equal(DEFAULT_MAX_ALLOCATION);
    expect(await pool.totalPurchasedCurrency()).to.equal(parseEther('2'));
    expect(await ethers.provider.getBalance(pool.address)).to.equal(parseEther('2'));
  });

  it('cannot purchase with native currency after purchase deadline has passed', async function () {
    await createPool({
      ...defaultAddress(),
    });

    await time.increase('1000');

    await expect(pool.connect(alice).purchaseNative({ value: DEFAULT_MAX_ALLOCATION })).to.be.revertedWith('ANYPAD: Pool expired');
  });

  it('cannot purchase with native currency more than max allocation', async function () {
    await createPool({
      ...defaultAddress(),
    });

    await pool.connect(alice).purchaseNative({ value: parseEther('0.5') });
    
    // over allocation
    await expect(pool.connect(alice).purchaseNative({value: DEFAULT_MAX_ALLOCATION})).to.be.revertedWith('ANYPAD: Buying more than allowed');

    // under allocation
    await pool.connect(alice).purchaseNative({ value: parseEther('0.2') });

    expect(await pool.purchasedCurrencyOf(alice.address)).to.equal(parseEther('0.7'));  
    expect(await ethers.provider.getBalance(pool.address)).to.equal(parseEther('0.7')); 

  });

  it('returns correct settleable amounts', async function () {
    await createPool({
      ...defaultAddress(),
    });

    const total = await pool.totalSettleable();

    expect(total.completed_).to.equal(false);
    expect(total.amount).to.equal('0');
    expect(total.volume).to.equal('0');
    expect(total.rate).to.equal(parseEther('1'));

    await pool.connect(alice).purchaseNative({ value: DEFAULT_MAX_ALLOCATION });

    let aliceTotal = await pool.settleable(alice.address);

    expect(aliceTotal.completed_).to.equal(false);
    expect(aliceTotal.refundAmount).to.equal(parseEther('0.9'));
    expect(aliceTotal.volume).to.equal(parseEther('100'));
    expect(aliceTotal.rate).to.equal(parseEther('0.1'));

    await pool.connect(bob).purchaseNative({ value: DEFAULT_MAX_ALLOCATION });


    aliceTotal = await pool.settleable(alice.address);
    const bobTotal = await pool.settleable(bob.address);

    expect(aliceTotal.completed_).to.equal(false);
    expect(aliceTotal.refundAmount).to.equal(parseEther('0.95'));
    expect(aliceTotal.volume).to.equal(parseEther('50'));
    expect(aliceTotal.rate).to.equal(parseEther('0.05'));

    expect(bobTotal.completed_).to.equal(false);
    expect(bobTotal.refundAmount).to.equal(parseEther('0.95'));
    expect(bobTotal.volume).to.equal(parseEther('50'));
    expect(bobTotal.rate).to.equal(parseEther('0.05'));

  });

  it('guard against reentrancy attack', async function () {
    await createPool({
      ...defaultAddress(),
      maxAllocation: parseEther('10')
    });

    const Attacker = await ethers.getContractFactory('AttackerContract');
    const attacker = await Attacker.deploy();
    await attacker.setPublicPoolAddress(pool.address);
    await governance.sendTransaction({ to: attacker.address, value: parseEther('11') });

    await pool.connect(alice).purchaseNative({ value: parseEther('10') });
    await pool.connect(bob).purchaseNative({ value: parseEther('10') });
    await attacker.purchasePublic();

    //fast forward to settle time
    await time.increase('2000');

    await expect(attacker.attackPublic()).to.be.revertedWith('Address: unable to send value, recipient may have reverted');
  });

  it('withdrawable returns appropriate amount', async function () {
    await createPool({
      ...defaultAddress(),
    });

    let withdrawable = await pool.withdrawable();

    expect(withdrawable.amount_).to.equal('0');
    expect(withdrawable.volume_).to.equal('0');

    await pool.connect(alice).purchaseNative({ value: parseEther('0.05') });

    //fast forward to settle time
    await time.increase('3000');

    await pool.settle();

    withdrawable =  await pool.withdrawable();

    expect(withdrawable.amount_).to.equal(parseEther('0.05'));
    expect(withdrawable.volume_).to.equal(parseEther('50'));

  });

  it('can withdraw after settle time is passed', async function () {
    await createPool({
      ...defaultAddress(),
    });

    await pool.connect(alice).purchaseNative({ value: parseEther('0.05') });

    //fast forward to settle time
    await time.increase('3000');

    await pool.settle();

    await pool.withdraw(governance.address, parseEther('1'), parseEther('100'));

    expect(await ethers.provider.getBalance(pool.address)).to.equal('0');

    expect(await token.balanceOf(pool.address)).to.equal(parseEther('50'));
  });

  it('cant withdraw if settle time is not passed', async function () {
    await createPool({
      ...defaultAddress(),
    });
    await expect(pool.withdraw(governance.address, parseEther('1'), parseEther('100')))
              .to.be.revertedWith('ANYPAD: Pool is incomplete');

  });
});