import { AztecRPCServer } from '@aztec/aztec-rpc';
import { AccountManager, AuthWitnessProvider, BaseAccountContract, CompleteAddress, Fr } from '@aztec/aztec.js';
import { GrumpkinPrivateKey, GrumpkinScalar } from '@aztec/circuits.js';
import { Schnorr } from '@aztec/circuits.js/barretenberg';
import { PrivateTokenContract, SchnorrHardcodedAccountContractAbi } from '@aztec/noir-contracts/types';
import { AuthWitness } from '@aztec/types';

import { setup } from '../fixtures/utils.js';

// docs:start:account-contract
const PRIVATE_KEY = GrumpkinScalar.fromString('0xd35d743ac0dfe3d6dbe6be8c877cb524a00ab1e3d52d7bada095dfc8894ccfa');

/** Account contract implementation that authenticates txs using Schnorr signatures. */
class SchnorrHardcodedKeyAccountContract extends BaseAccountContract {
  constructor(private privateKey: GrumpkinPrivateKey = PRIVATE_KEY) {
    super(SchnorrHardcodedAccountContractAbi);
  }

  getDeploymentArgs(): Promise<any[]> {
    // This contract does not require any arguments in its constructor.
    return Promise.resolve([]);
  }

  getAuthWitnessProvider(_address: CompleteAddress): AuthWitnessProvider {
    const privateKey = this.privateKey;
    return {
      async createAuthWitness(message: Fr): Promise<AuthWitness> {
        const signer = await Schnorr.new();
        const signature = signer.constructSignature(message.toBuffer(), privateKey);
        return new AuthWitness(message, [...signature.toBuffer()]);
      },
    };
  }
}
// docs:end:account-contract

describe('guides/writing_an_account_contract', () => {
  let context: Awaited<ReturnType<typeof setup>>;

  beforeEach(async () => {
    context = await setup(0);
  }, 60_000);

  afterEach(async () => {
    await context.aztecNode?.stop();
    if (context.aztecRpcServer instanceof AztecRPCServer) {
      await context.aztecRpcServer.stop();
    }
  });

  it('works', async () => {
    const { aztecRpcServer: rpc, logger } = context;
    // docs:start:account-contract-deploy
    const encryptionPrivateKey = GrumpkinScalar.random();
    const account = new AccountManager(rpc, encryptionPrivateKey, new SchnorrHardcodedKeyAccountContract());
    const wallet = await account.waitDeploy();
    const address = wallet.getCompleteAddress().address;
    // docs:end:account-contract-deploy
    logger(`Deployed account contract at ${address}`);

    // docs:start:account-contract-works
    const token = await PrivateTokenContract.deploy(wallet, 100, address).send().deployed();
    logger(`Deployed token contract at ${token.address}`);

    await token.methods.mint(50, address).send().wait();
    const balance = await token.methods.getBalance(address).view();
    logger(`Balance of wallet is now ${balance}`);
    // docs:end:account-contract-works
    expect(balance).toEqual(150n);

    // docs:start:account-contract-fails
    const walletAddress = wallet.getCompleteAddress();
    const wrongKey = GrumpkinScalar.random();
    const wrongAccountContract = new SchnorrHardcodedKeyAccountContract(wrongKey);
    const wrongAccount = new AccountManager(rpc, encryptionPrivateKey, wrongAccountContract, walletAddress);
    const wrongWallet = await wrongAccount.getWallet();
    const tokenWithWrongWallet = token.withWallet(wrongWallet);

    try {
      await tokenWithWrongWallet.methods.mint(200, address).simulate();
    } catch (err) {
      logger(`Failed to send tx: ${err}`);
    }
    // docs:end:account-contract-fails
  }, 60_000);
});
