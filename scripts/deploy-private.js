const poolConfig = {
  recipient: '0xb60f97B7677C04ccD679292601C91291bceC5e9D',

  currency: '0x0000000000000000000000000000000000000000',
  underlying: '0x07BD57d25e46229Ec0e3fece09f0d2C896f7Df20',
  ratio: '1200000000000000000000',
  purchaseTime: '1624866462',
  withdrawTime: '1624949124',
};

async function main() {
  const AdminUpgradeabilityProxy = await ethers.getContractFactory(
    'AdminUpgradeabilityProxy'
  );
  const AnyPadPrivatePool = await ethers.getContractFactory(
    'AnyPadPrivatePool'
  );

  let implementation = process.env.PRIVATE_IMPLEMENTATION;

  if (!implementation) {
    const pool = await AnyPadPrivatePool.deploy();
    implementation = pool.address;
  }

  const clone = await AdminUpgradeabilityProxy.deploy(
    process.env.ADMIN,
    implementation,
    '0x',
    {
      gasLimit: 3000000,
    }
  );

  const provider = new ethers.providers.JsonRpcProvider(process.env.RPC);
  const wallet = new ethers.Wallet(
    process.env.GOVERNANCE_PRIVATE_KEY,
    provider
  );

  await AnyPadPrivatePool.connect(wallet)
    .attach(clone.address)
    .__AnyPadPrivatePool_init(
      process.env.GOVERNANCE,
      poolConfig.currency,
      poolConfig.underlying,
      poolConfig.ratio,
      poolConfig.recipient,
      poolConfig.purchaseTime,
      poolConfig.withdrawTime,
      {
        gasLimit: 3000000,
      }
    );

  console.log(`Implementation address: ${implementation}`);
  console.log(`Pool address: ${clone.address}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
