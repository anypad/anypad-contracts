const { constants, time } = require('@openzeppelin/test-helpers');
const { expect } = require('chai');
const hre = require('hardhat');
const { ethers } = require('hardhat');
const { parseEther } = hre.ethers.utils;

const DEFAULT_RATIO = parseEther('1000');
const TOTAL_VOLUME = parseEther('2000');

describe('AnyPadPrivatePool', async function () {
  let pool;
  let token;
  let currencyToken;
  let governance;
  let recipient;
  let alice;
  let bob;
  let charlie;

  const currencyNative = constants.ZERO_ADDRESS;

  const defaultAddress = () => ({
    governance: governance,
    token: token,
    currency: currencyNative,
    pool: pool,
    recipient: recipient,
  });

  const createPool = async({
    pool,
    governance,
    currency,
    token,
    recipient,
    totalVolume = TOTAL_VOLUME,
    ratio = DEFAULT_RATIO,
    currentTime,
    purchaseTimeFromCurrent = 1000,
    withdrawTimeFromPurchase = 1000,
  }) => {
    currentTime = currentTime
      ? currentTime
      : Math.round(await time.latest());
    const purchaseTime = currentTime + purchaseTimeFromCurrent;
    const withdrawTime = purchaseTime + withdrawTimeFromPurchase;

    await pool.__AnyPadPrivatePool_init(
      governance.address,
      currency,
      token.address,
      ratio,
      recipient.address,
      purchaseTime,
      withdrawTime,
    );

    await token.connect(governance).transfer(pool.address, totalVolume);
  }

  const giveCurrencyToken = async (toAddress, amount) => {
    await currencyToken.connect(governance).transfer(toAddress, amount);
  }

  
  beforeEach(async function () {
    const Token = await ethers.getContractFactory('MockERC20');
    const Pool = await ethers.getContractFactory('AnyPadPrivatePool');

    [governance, recipient, alice, bob, charlie,] = await ethers.getSigners();

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
    expect(await pool.sellingToken()).to.equal(token.address);
    expect(await pool.ratio()).to.equal(DEFAULT_RATIO);
    expect(await pool.recipient()).to.equal(recipient.address);
    expect(await pool.purchaseTime()).to.equal(currentTime + 1000);
    expect(await pool.withdrawTime()).to.equal(currentTime + 2000);
  });

  it('throw when invalid date supplied', async function () {
    await expect(createPool({
      purchaseTimeFromCurrent: 1000,
      withdrawTimeFromPurchase: -1000,
      ...defaultAddress(),
    })).to.be.revertedWith('ANYPAD: purchaseTime_ should be before withdrawTime_');
  });

  it('throw when selling token is zero', async function () {
    await expect(createPool({
      ...defaultAddress(),
      token: { address: constants.ZERO_ADDRESS },
    })).to.be.revertedWith('ANYPAD: sellingToken_ address cannot be 0');
  });

  it('throw when recipient address is zero', async function () {
    await expect(createPool({
      ...defaultAddress(),
      recipient: { address: constants.ZERO_ADDRESS }
    })).to.be.revertedWith('ANYPAD: recipient_ address cannot be 0');
  });

  it('can change recipient', async function () {
    await createPool({
      ...defaultAddress(),
    });

    await pool.setRecipient(governance.address);
    expect(await pool.recipient()).to.equal(governance.address);
  });

  it('can set same allocation for multiple users', async function () {
    await createPool({
      ...defaultAddress(),
    });

    // await pool.setAllocation(alice.address, parseEther('1'));
    await pool['setAllocations(address[],uint256)']([alice.address, bob.address], parseEther('1'));

    expect(await pool.totalAllocation()).to.equal(parseEther('2'));
    expect(await pool.allocationOf(alice.address)).to.equal(parseEther('1'));
    expect(await pool.allocationOf(bob.address)).to.equal(parseEther('1'));

  });

  it('can set different allocation for different users', async function () {
    await createPool({
      ...defaultAddress(),
    });

    await pool['setAllocations(address[],uint256[])']([
      alice.address,
      bob.address,
    ], [
      parseEther('1'), 
      parseEther('2')
    ]);

    expect(await pool.totalAllocation()).to.equal(parseEther('3'));
    expect(await pool.allocationOf(alice.address)).to.equal(parseEther('1'));
    expect(await pool.allocationOf(bob.address)).to.equal(parseEther('2'));
  });

  it('cannot set allocations if arrays length is not the same', async function () {
    await createPool({
      ...defaultAddress(),
    });

    await expect(pool['setAllocations(address[],uint256[])']([
      alice.address,
      bob.address,
    ], [
      parseEther('1'), 
    ])).to.be.revertedWith('ANYPAD: users length must be the same as amounts length');
  });

  it('can purchase with native currency', async function() {
    await createPool({
      ...defaultAddress(),
    });

    await pool['setAllocations(address[],uint256[])']([
      alice.address,
      bob.address,
    ], [
      parseEther('1'), 
      parseEther('1')
    ]);

    await time.increase('1000');

    await pool.connect(alice).purchaseNative({value: parseEther('1')});
    expect(await pool.purchasedOf(alice.address)).to.equal(parseEther('1000'));
    expect(await pool.totalPurchased()).to.equal(parseEther('1000'));

    await pool.connect(bob).purchaseNative({value: parseEther('1')});
    expect(await pool.purchasedOf(alice.address)).to.equal(parseEther('1000'));
    expect(await pool.totalPurchased()).to.equal(parseEther('2000'));
  });

  it('cant purchase if time is not right', async function() {
    await createPool({
      ...defaultAddress(),
    });

    await pool['setAllocations(address[],uint256[])']([
      alice.address,
      bob.address,
    ], [
      parseEther('1'), 
      parseEther('1')
    ]);

    await expect(pool.connect(alice).purchaseNative({value: parseEther('1')})).to.be.revertedWith('ANYPAD: Pool has not started yet');
    await time.increase('3000');
    await expect(pool.connect(alice).purchaseNative({value: parseEther('1')})).to.be.revertedWith('ANYPAD: Pool expired');
  });

  it('cant purchase if not whitelisted', async function() {
    await createPool({
      ...defaultAddress(),
    });

    await pool['setAllocations(address[],uint256[])']([
      alice.address,
      bob.address,
    ], [
      parseEther('1'), 
      parseEther('1')
    ]);

    await time.increase('1000');

    await expect(pool.connect(charlie).purchaseNative({value: parseEther('1')})).to.be.revertedWith('ANYPAD: No allocation');
  });

  it('cant purchase twice', async function() {
    await createPool({
      ...defaultAddress(),
    });

    await pool['setAllocations(address[],uint256[])']([
      alice.address,
      bob.address,
    ], [
      parseEther('1'), 
      parseEther('1')
    ]);

    await time.increase('1000');

    await pool.connect(alice).purchaseNative({value: parseEther('1')});
    await expect(pool.connect(alice).purchaseNative({value: parseEther('1')})).to.be.revertedWith('ANYPAD: Already purchased');
  });

  it('cant purchase if pool does not have enough tokens', async function() {
    await createPool({
      ...defaultAddress(),
    });

    await pool['setAllocations(address[],uint256[])']([
      alice.address,
      bob.address,
      charlie.address,
    ], [
      parseEther('1'), 
      parseEther('1'),
      parseEther('1'), 
    ]);

    await time.increase('1000');

    await pool.connect(alice).purchaseNative({value: parseEther('1')});
    await pool.connect(bob).purchaseNative({value: parseEther('1')});
    await expect(pool.connect(charlie).purchaseNative({value: parseEther('1')})).to.be.revertedWith('ANYPAD: Not enough tokens left to purchase');
  });

  it('refund users if exceeds allocation', async function() {
    await createPool({
      ...defaultAddress(),
    });

    await pool['setAllocations(address[],uint256[])']([
      alice.address,
      bob.address,
    ], [
      parseEther('1'), 
      parseEther('1'),
    ]);

    await time.increase('1000');
    const oldBalance = await ethers.provider.getBalance(alice.address);
    await pool.connect(alice).purchaseNative({value: parseEther('2')});
    const newBalance = await ethers.provider.getBalance(alice.address);
    expect(oldBalance.sub(newBalance).lt(parseEther('2'))).to.equal(true);
  });

  it('guard against reentrancy attack', async function() {
    await createPool({
      ...defaultAddress(),
      totalVolume: parseEther('10000'),
    });
    await time.increase('1000');
    const Attacker = await ethers.getContractFactory('AttackerContract');
    const attacker = await Attacker.deploy();
    await governance.sendTransaction({ to: attacker.address, value: parseEther('11') });
    await attacker.setPrivatePoolAddress(pool.address);


    await pool['setAllocations(address[],uint256[])']([
      alice.address,
      bob.address,
      attacker.address,
    ], [
      parseEther('1'), 
      parseEther('1'),
      parseEther('1'),
    ]);

    await pool.connect(alice).purchaseNative({value: parseEther('1')});
    await pool.connect(bob).purchaseNative({value: parseEther('1')});
    await expect(attacker.attackPrivate(parseEther('2'))).to.be.revertedWith('Address: unable to send value, recipient may have reverted');

    expect(await pool.totalPurchased()).to.equal(parseEther('2000'));
  });

  it('returns correct withdrawable', async function() {
    await createPool({
      ...defaultAddress(),
    });
    
    let withdrawable = await pool.withdrawable();

    expect(withdrawable.amount_).to.equal('0');
    expect(withdrawable.volume_).to.equal('0');

    await pool['setAllocations(address[],uint256[])']([
      alice.address,
      bob.address,
    ], [
      parseEther('1'), 
      parseEther('1'),
    ]);

    await time.increase('1000');

    await pool.connect(alice).purchaseNative({value: parseEther('1')});

    await time.increase('1000');

    withdrawable = await pool.withdrawable();

    expect(withdrawable.amount_).to.equal('0');
    expect(withdrawable.volume_).to.equal(parseEther('1000'));
  });

  it('can withdraw after withdraw time has passed', async function() {
    await createPool({
      ...defaultAddress(),
    });

    await pool['setAllocations(address[],uint256[])']([
      alice.address,
      bob.address,
    ], [
      parseEther('1'), 
      parseEther('1'),
    ]);

    await time.increase('1000');

    await pool.connect(alice).purchaseNative({value: parseEther('1')});

    await expect(pool.withdraw(recipient.address, '0', parseEther('2000'))).to.be.revertedWith('ANYPAD: Pool is incomplete');

    await time.increase('1000');

    await pool.withdraw(recipient.address, '0', parseEther('2000'));

    expect(await token.balanceOf(recipient.address)).to.equal(parseEther('1000'));
  });

  it('can claim tokens after withdraw time has passed', async function () {
    await createPool({
      ...defaultAddress(),
    });

    await pool['setAllocations(address[],uint256[])']([
      alice.address,
      bob.address,
    ], [
      parseEther('1'), 
      parseEther('1'),
    ]);

    await time.increase('1000');

    await pool.connect(alice).purchaseNative({value: parseEther('1')});

    await time.increase('1000');

    await pool.connect(alice).claim();

    expect(await pool.claimedOf(alice.address)).to.equal(parseEther('1000'));
    expect(await pool.totalClaimed()).to.equal(parseEther('1000'));
    expect(await token.balanceOf(alice.address)).to.equal(parseEther('1000'));
    expect(await token.balanceOf(recipient.address)).to.equal(parseEther('1000'));
    expect(await token.balanceOf(pool.address)).to.equal('0');

  });

  it('cant claim tokens if withdraw time has not come', async function () {
    await createPool({
      ...defaultAddress(),
    });

    await pool['setAllocations(address[],uint256[])']([
      alice.address,
      bob.address,
    ], [
      parseEther('1'), 
      parseEther('1'),
    ]);

    await time.increase('1000');

    await pool.connect(alice).purchaseNative({value: parseEther('1')});

    await expect(pool.connect(alice).claim()).to.be.revertedWith('ANYPAD: Claim phase has not started');

  });

  it('cant claim tokens if aldready claimed', async function () {
    await createPool({
      ...defaultAddress(),
    });

    await pool['setAllocations(address[],uint256[])']([
      alice.address,
      bob.address,
    ], [
      parseEther('1'), 
      parseEther('1'),
    ]);

    await time.increase('1000');

    await pool.connect(alice).purchaseNative({value: parseEther('1')});

    await time.increase('1000');

    await pool.connect(alice).claim();

    await expect(pool.connect(alice).claim()).to.be.revertedWith('ANYPAD: Already claimed');

  });
});