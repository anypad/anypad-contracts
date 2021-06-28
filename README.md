## anypad-contracts

1.

```
npm install
```

2. Edit `.env.development` with the required information

```
ADMIN=
ADMIN_PRIVATE_KEY=
GOVERNANCE=
GOVERNANCE_PRIVATE_KEY=
```

Admin is the account that can update the implementation of the `AdminUpgradeabilityProxy` contract.
Governance is the owner of the deployed pools.

3.

```
cp .env.development .env
```

4. Deploy to testnet

Public pool:

```
npm run deploy-public-test
```

Private pool:

```
npm run deploy-private-test
```