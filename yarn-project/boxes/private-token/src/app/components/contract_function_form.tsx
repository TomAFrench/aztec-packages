import { AztecAddress, CompleteAddress, Fr } from '@aztec/aztec.js';
import { ContractAbi, FunctionAbi } from '@aztec/foundation/abi';
import { useFormik } from 'formik';
import * as Yup from 'yup';
import { CONTRACT_ADDRESS_PARAM_NAMES, DEFAULT_PUBLIC_ADDRESS, rpcClient } from '../../config.js';
import { callContractFunction, deployContract, viewContractFunction } from '../../scripts/index.js';
import { convertArgs } from '../../scripts/util.js';
import { Button } from './index.js';

type NoirFunctionYupSchema = {
  // hack: add `any` at the end to get the array schema to typecheck
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: Yup.NumberSchema | Yup.ArraySchema<number[], object> | Yup.BooleanSchema | any;
};

type NoirFunctionFormValues = {
  [key: string]: string | number | number[] | boolean;
};

function generateYupSchema(functionAbi: FunctionAbi) {
  const parameterSchema: NoirFunctionYupSchema = {};
  const initialValues: NoirFunctionFormValues = {};
  for (const param of functionAbi.parameters) {
    if (CONTRACT_ADDRESS_PARAM_NAMES.includes(param.name)) {
  // these are hex strings instead, but yup doesn't support bigint so we convert back to bigint on execution
      parameterSchema[param.name] = Yup.string().required();
      initialValues[param.name] = DEFAULT_PUBLIC_ADDRESS;
      continue;
    }
    switch (param.type.kind) {
      case 'field':
        parameterSchema[param.name] = Yup.number().required();
        initialValues[param.name] = 100;
        break;
    // not really needed for private token, since we hide the nullifier helper method which has the array input
      case 'array':
        // eslint-disable-next-line no-case-declarations
        const arrayLength = param.type.length;
        parameterSchema[param.name] = Yup.array()
          .of(Yup.number())
          .min(arrayLength)
          .max(arrayLength)
          .transform(function (value: number[], originalValue: string) {
            if (typeof originalValue === 'string') {
              return originalValue.split(',').map(Number);
            }
            return value;
          });
        initialValues[param.name] = Array(arrayLength).fill(
          CONTRACT_ADDRESS_PARAM_NAMES.includes(param.name) ? DEFAULT_PUBLIC_ADDRESS : 200,
        );
        break;
      case 'boolean':
        parameterSchema[param.name] = Yup.boolean().required();
        initialValues[param.name] = false;
        break;
    }
  }
  return { validationSchema: Yup.object().shape(parameterSchema), initialValues };
}

async function handleFunctionCall(
  contractAddress: AztecAddress | undefined,
  contractAbi: ContractAbi,
  functionName: string,
  args: any,
  wallet: CompleteAddress,
) {
  const functionAbi = contractAbi.functions.find(f => f.name === functionName)!;
  const typedArgs: any[] = convertArgs(functionAbi, args);

  if (functionName === 'constructor' && !!wallet) {
    if (functionAbi === undefined) {
      throw new Error('Cannot find constructor in the ABI.');
    }
    // hack: addresses are stored as string in the form to avoid bigint compatibility issues with formik
    // convert those back to bigints before sending

    // for now, dont let user change the salt.  requires some change to the form generation if we want to let user choose one
    // since everything is currently based on parsing the contractABI, and the salt parameter is not present there
    const salt = Fr.random();
    return await deployContract(wallet, contractAbi, typedArgs, salt, rpcClient);
  }

  if (functionAbi.functionType === 'unconstrained') {
    return await viewContractFunction(contractAddress!, contractAbi, functionName, typedArgs, rpcClient, wallet);
  } else {
    return await callContractFunction(contractAddress!, contractAbi, functionName, typedArgs, rpcClient, wallet);
  }
}

interface ContractFunctionFormProps {
  wallet: CompleteAddress;
  contractAddress?: AztecAddress;
  contractAbi: ContractAbi;
  functionAbi: FunctionAbi;
  title?: string;
  buttonText?: string;
  isLoading: boolean;
  disabled: boolean;
  onSubmit: () => void;
  onSuccess: (result: any) => void;
  onError: (msg: string) => void;
}

export function ContractFunctionForm({
  wallet,
  contractAddress,
  contractAbi,
  functionAbi,
  title,
  buttonText = 'Submit',
  isLoading,
  disabled,
  onSubmit,
  onSuccess,
  onError,
}: ContractFunctionFormProps) {
  const { validationSchema, initialValues } = generateYupSchema(functionAbi);
  const formik = useFormik({
    initialValues: initialValues,
    validationSchema: validationSchema,
    onSubmit: async (values: any) => {
      onSubmit();
      try {
        const result = await handleFunctionCall(contractAddress, contractAbi, functionAbi.name, values, wallet);
        onSuccess(result);
      } catch (e: any) {
        onError(e.message);
      }
    },
  });

  return (
    <div className="rounded-sm py-8">
      <h2 className="py-4 text-lg">{title || `${functionAbi.name} (${functionAbi.functionType})`}</h2>
      <form onSubmit={formik.handleSubmit} className="flex justify-between items-end py-4">
        <div className="flex flex-wrap justify-start">
          {functionAbi.parameters.map(input => (
            <div key={input.name} className="inline-block text-left p-1">
              <label htmlFor={input.name} className="block p-1">
                {input.name} ({input.type.kind})
              </label>
              <div className="block p-1">
                <input
                  className="border-gray-300 rounded-md shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200 focus:ring-opacity-50 p-2"
                  id={input.name}
                  name={input.name}
                  type="text"
                  onChange={formik.handleChange}
                  value={formik.values[input.name]}
                />
              </div>
              {formik.touched[input.name] && formik.errors[input.name] && (
                <div>{formik.errors[input.name]?.toString()}</div>
              )}
            </div>
          ))}
        </div>
        <div className="p-2">
          <Button isLoading={isLoading} disabled={disabled}>
            {buttonText}
          </Button>
        </div>
      </form>
    </div>
  );
}
