const poolConfig = {
  currency: '0x0000000000000000000000000000000000000000',
  underlying: '0x07BD57d25e46229Ec0e3fece09f0d2C896f7Df20',
  price: '1000000000000000',
  maxAllocation: '1000000000000000000',
  purchaseDeadline: '1624949124',
  settleTime: '1624949124',
};

async function main() {
  const AdminUpgradeabilityProxy = await ethers.getContractFactory(
    'AdminUpgradeabilityProxy'
  );
  const AnyPadPublicPool = await ethers.getContractFactory('AnyPadPublicPool');

  let implementation = process.env.PUBLIC_IMPLEMENTATION;

  if (!implementation) {
    const pool = await AnyPadPublicPool.deploy();
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

  await AnyPadPublicPool.connect(wallet)
    .attach(clone.address)
    .__AnyPadPublicPool_init(
      process.env.GOVERNANCE,
      poolConfig.currency,
      poolConfig.underlying,
      poolConfig.price,
      poolConfig.maxAllocation,
      poolConfig.purchaseDeadline,
      poolConfig.settleTime,
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
