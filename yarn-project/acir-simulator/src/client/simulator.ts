import { CallContext, FunctionData, MAX_NOTE_FIELDS_LENGTH, TxContext } from '@aztec/circuits.js';
import { Grumpkin } from '@aztec/circuits.js/barretenberg';
import { ArrayType, FunctionSelector, FunctionType, encodeArguments } from '@aztec/foundation/abi';
import { AztecAddress } from '@aztec/foundation/aztec-address';
import { EthAddress } from '@aztec/foundation/eth-address';
import { Fr } from '@aztec/foundation/fields';
import { DebugLogger, createDebugLogger } from '@aztec/foundation/log';
import { AztecNode, FunctionCall, TxExecutionRequest } from '@aztec/types';

import { WasmBlackBoxFunctionSolver, createBlackBoxSolver } from '@noir-lang/acvm_js';

import { createSimulationError } from '../common/errors.js';
import { PackedArgsCache } from '../common/packed_args_cache.js';
import { ClientTxExecutionContext } from './client_execution_context.js';
import { DBOracle, FunctionAbiWithDebugMetadata } from './db_oracle.js';
import { ExecutionNoteCache } from './execution_note_cache.js';
import { ExecutionResult } from './execution_result.js';
import { PrivateFunctionExecution } from './private_execution.js';
import { UnconstrainedFunctionExecution } from './unconstrained_execution.js';

/**
 * The ACIR simulator.
 */
export class AcirSimulator {
  private static solver: Promise<WasmBlackBoxFunctionSolver>; // ACVM's backend
  private log: DebugLogger;

  constructor(private db: DBOracle) {
    this.log = createDebugLogger('aztec:simulator');
  }

  /**
   * Gets or initializes the ACVM WasmBlackBoxFunctionSolver.
   *
   * @remarks
   *
   * Occurs only once across all instances of AcirSimulator.
   * Speeds up execution by only performing setup tasks (like pedersen
   * generator initialization) one time.
   * TODO(https://github.com/AztecProtocol/aztec-packages/issues/1627):
   * determine whether this requires a lock
   *
   * @returns ACVM WasmBlackBoxFunctionSolver
   */
  public static getSolver(): Promise<WasmBlackBoxFunctionSolver> {
    if (!this.solver) this.solver = createBlackBoxSolver();
    return this.solver;
  }

  /**
   * Runs a private function.
   * @param request - The transaction request.
   * @param entryPointABI - The ABI of the entry point function.
   * @param contractAddress - The address of the contract (should match request.origin)
   * @param portalContractAddress - The address of the portal contract.
   * @param msgSender - The address calling the function. This can be replaced to simulate a call from another contract or a specific account.
   * @returns The result of the execution.
   */
  public async run(
    request: TxExecutionRequest,
    entryPointABI: FunctionAbiWithDebugMetadata,
    contractAddress: AztecAddress,
    portalContractAddress: EthAddress,
    msgSender = AztecAddress.ZERO,
  ): Promise<ExecutionResult> {
    if (entryPointABI.functionType !== FunctionType.SECRET) {
      throw new Error(`Cannot run ${entryPointABI.functionType} function as secret`);
    }

    if (request.origin !== contractAddress) {
      this.log.warn(
        `Request origin does not match contract address in simulation. Request origin: ${request.origin}, contract address: ${contractAddress}`,
      );
    }

    const curve = await Grumpkin.new();

    const historicBlockData = await this.db.getHistoricBlockData();
    const callContext = new CallContext(
      msgSender,
      contractAddress,
      portalContractAddress,
      false,
      false,
      request.functionData.isConstructor,
    );

    const execution = new PrivateFunctionExecution(
      new ClientTxExecutionContext(
        this.db,
        request.txContext,
        historicBlockData,
        await PackedArgsCache.create(request.packedArguments),
        new ExecutionNoteCache(),
        request.authWitnesses,
      ),
      entryPointABI,
      contractAddress,
      request.functionData,
      request.argsHash,
      callContext,
      curve,
    );

    try {
      return await execution.run();
    } catch (err) {
      throw createSimulationError(err instanceof Error ? err : new Error('Unknown error during private execution'));
    }
  }

  /**
   * Runs an unconstrained function.
   * @param request - The transaction request.
   * @param origin - The sender of the request.
   * @param entryPointABI - The ABI of the entry point function.
   * @param contractAddress - The address of the contract.
   * @param portalContractAddress - The address of the portal contract.
   * @param historicBlockData - Block data containing historic roots.
   * @param aztecNode - The AztecNode instance.
   */
  public async runUnconstrained(
    request: FunctionCall,
    origin: AztecAddress,
    entryPointABI: FunctionAbiWithDebugMetadata,
    contractAddress: AztecAddress,
    portalContractAddress: EthAddress,
    aztecNode?: AztecNode,
  ) {
    if (entryPointABI.functionType !== FunctionType.UNCONSTRAINED) {
      throw new Error(`Cannot run ${entryPointABI.functionType} function as constrained`);
    }

    const historicBlockData = await this.db.getHistoricBlockData();
    const callContext = new CallContext(
      origin,
      contractAddress,
      portalContractAddress,
      false,
      false,
      request.functionData.isConstructor,
    );

    const execution = new UnconstrainedFunctionExecution(
      new ClientTxExecutionContext(
        this.db,
        TxContext.empty(),
        historicBlockData,
        await PackedArgsCache.create([]),
        new ExecutionNoteCache(),
        [],
      ),
      entryPointABI,
      contractAddress,
      request.functionData,
      request.args,
      callContext,
    );

    try {
      return await execution.run(aztecNode);
    } catch (err) {
      throw createSimulationError(err instanceof Error ? err : new Error('Unknown error during private execution'));
    }
  }

  /**
   * Computes the inner nullifier of a note.
   * @param contractAddress - The address of the contract.
   * @param nonce - The nonce of the note hash.
   * @param storageSlot - The storage slot.
   * @param notePreimage - The note preimage.
   * @returns The nullifier.
   */
  public async computeNoteHashAndNullifier(
    contractAddress: AztecAddress,
    nonce: Fr,
    storageSlot: Fr,
    notePreimage: Fr[],
  ) {
    let abi: FunctionAbiWithDebugMetadata | undefined = undefined;

    // Brute force
    for (let i = 0; i < MAX_NOTE_FIELDS_LENGTH; i++) {
      const signature = `compute_note_hash_and_nullifier(Field,Field,Field,[Field;${i}])`;
      const selector = FunctionSelector.fromSignature(signature);
      try {
        abi = await this.db.getFunctionABI(contractAddress, selector);
        if (abi !== undefined) break;
      } catch (e) {
        // ignore
      }
    }

    if (abi == undefined) {
      throw new Error(
        `Mandatory implementation of "compute_note_hash_and_nullifier" missing in noir contract ${contractAddress.toString()}.`,
      );
    }

    const preimageLen = (abi.parameters[3].type as ArrayType).length;
    const extendedPreimage = notePreimage.concat(Array(preimageLen - notePreimage.length).fill(Fr.ZERO));

    const execRequest: FunctionCall = {
      to: AztecAddress.ZERO,
      functionData: FunctionData.empty(),
      args: encodeArguments(abi, [contractAddress, nonce, storageSlot, extendedPreimage]),
    };

    const [innerNoteHash, siloedNoteHash, uniqueSiloedNoteHash, innerNullifier] = (await this.runUnconstrained(
      execRequest,
      AztecAddress.ZERO,
      abi,
      AztecAddress.ZERO,
      EthAddress.ZERO,
    )) as bigint[];

    return {
      innerNoteHash: new Fr(innerNoteHash),
      siloedNoteHash: new Fr(siloedNoteHash),
      uniqueSiloedNoteHash: new Fr(uniqueSiloedNoteHash),
      innerNullifier: new Fr(innerNullifier),
    };
  }

  /**
   * Computes the inner note hash of a note, which contains storage slot and the custom note hash.
   * @param contractAddress - The address of the contract.
   * @param storageSlot - The storage slot.
   * @param notePreimage - The note preimage.
   * @param abi - The ABI of the function `compute_note_hash`.
   * @returns The note hash.
   */
  public async computeInnerNoteHash(contractAddress: AztecAddress, storageSlot: Fr, notePreimage: Fr[]) {
    const { innerNoteHash } = await this.computeNoteHashAndNullifier(
      contractAddress,
      Fr.ZERO,
      storageSlot,
      notePreimage,
    );
    return innerNoteHash;
  }

  /**
   * Computes the unique note hash of a note.
   * @param contractAddress - The address of the contract.
   * @param nonce - The nonce of the note hash.
   * @param storageSlot - The storage slot.
   * @param notePreimage - The note preimage.
   * @param abi - The ABI of the function `compute_note_hash`.
   * @returns The note hash.
   */
  public async computeUniqueSiloedNoteHash(
    contractAddress: AztecAddress,
    nonce: Fr,
    storageSlot: Fr,
    notePreimage: Fr[],
  ) {
    const { uniqueSiloedNoteHash } = await this.computeNoteHashAndNullifier(
      contractAddress,
      nonce,
      storageSlot,
      notePreimage,
    );
    return uniqueSiloedNoteHash;
  }

  /**
   * Computes the siloed note hash of a note.
   * @param contractAddress - The address of the contract.
   * @param nonce - The nonce of the note hash.
   * @param storageSlot - The storage slot.
   * @param notePreimage - The note preimage.
   * @param abi - The ABI of the function `compute_note_hash`.
   * @returns The note hash.
   */
  public async computeSiloedNoteHash(contractAddress: AztecAddress, nonce: Fr, storageSlot: Fr, notePreimage: Fr[]) {
    const { siloedNoteHash } = await this.computeNoteHashAndNullifier(
      contractAddress,
      nonce,
      storageSlot,
      notePreimage,
    );
    return siloedNoteHash;
  }

  /**
   * Computes the inner note hash of a note, which contains storage slot and the custom note hash.
   * @param contractAddress - The address of the contract.
   * @param nonce - The nonce of the unique note hash.
   * @param storageSlot - The storage slot.
   * @param notePreimage - The note preimage.
   * @param abi - The ABI of the function `compute_note_hash`.
   * @returns The note hash.
   */
  public async computeInnerNullifier(contractAddress: AztecAddress, nonce: Fr, storageSlot: Fr, notePreimage: Fr[]) {
    const { innerNullifier } = await this.computeNoteHashAndNullifier(
      contractAddress,
      nonce,
      storageSlot,
      notePreimage,
    );
    return innerNullifier;
  }
}
