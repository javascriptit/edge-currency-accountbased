/**
 * Created by paul on 8/8/17.
 */
// @flow

import { Buffer } from 'buffer'

import { bns } from 'biggystring'
import {
  type EdgeCorePluginOptions,
  type EdgeCurrencyEngine,
  type EdgeCurrencyEngineOptions,
  type EdgeCurrencyPlugin,
  type EdgeEncodeUri,
  type EdgeIo,
  type EdgeParsedUri,
  type EdgeWalletInfo
} from 'edge-core-js/types'
import EthereumUtil from 'ethereumjs-util'
import ethWallet from 'ethereumjs-wallet'

import { CurrencyPlugin } from '../common/plugin.js'
import { getDenomInfo, hexToBuf } from '../common/utils.js'
import { EthereumEngine } from './ethEngine.js'
import { currencyInfo } from './ethInfo.js'

export { calcMiningFee } from './ethMiningFees.js'

const defaultNetworkFees = {
  default: {
    gasLimit: {
      regularTransaction: '21000',
      tokenTransaction: '200000'
    },
    gasPrice: {
      lowFee: '1000000001',
      standardFeeLow: '40000000001',
      standardFeeHigh: '300000000001',
      standardFeeLowAmount: '100000000000000000',
      standardFeeHighAmount: '10000000000000000000',
      highFee: '40000000001'
    }
  },
  '1983987abc9837fbabc0982347ad828': {
    gasLimit: {
      regularTransaction: '21002',
      tokenTransaction: '37124'
    },
    gasPrice: {
      lowFee: '1000000002',
      standardFeeLow: '40000000002',
      standardFeeHigh: '300000000002',
      standardFeeLowAmount: '200000000000000000',
      standardFeeHighAmount: '20000000000000000000',
      highFee: '40000000002'
    }
  },
  '2983987abc9837fbabc0982347ad828': {
    gasLimit: {
      regularTransaction: '21002',
      tokenTransaction: '37124'
    }
  }
}

export class EthereumPlugin extends CurrencyPlugin {
  constructor (io: EdgeIo) {
    super(io, 'ethereum', currencyInfo)
  }

  async createPrivateKey (walletType: string): Promise<Object> {
    const type = walletType.replace('wallet:', '')

    if (type === 'ethereum') {
      const { io } = this
      const cryptoObj = {
        randomBytes: size => {
          const array = io.random(size)
          return Buffer.from(array)
        }
      }
      ethWallet.overrideCrypto(cryptoObj)

      const wallet = ethWallet.generate(false)
      const ethereumKey = wallet.getPrivateKeyString().replace('0x', '')
      return { ethereumKey }
    } else {
      throw new Error('InvalidWalletType')
    }
  }

  async derivePublicKey (walletInfo: EdgeWalletInfo): Promise<Object> {
    const type = walletInfo.type.replace('wallet:', '')
    if (type === 'ethereum') {
      const privKey = hexToBuf(walletInfo.keys.ethereumKey)
      const wallet = ethWallet.fromPrivateKey(privKey)

      const publicKey = wallet.getAddressString()
      return { publicKey }
    } else {
      throw new Error('InvalidWalletType')
    }
  }

  async parseUri (uri: string): Promise<EdgeParsedUri> {
    const networks = { ethereum: true, ether: true }

    const { parsedUri, edgeParsedUri } = this.parseUriCommon(
      currencyInfo,
      uri,
      networks
    )
    let address = ''
    if (edgeParsedUri.publicAddress) {
      address = edgeParsedUri.publicAddress
    }

    let [prefix, contractAddress] = address.split('-') // Split the address to get the prefix according to EIP-681
    // If contractAddress is null or undefined it means there is no prefix
    if (!contractAddress) {
      contractAddress = prefix // Set the contractAddress to be the prefix when the prefix is missing.
      prefix = 'pay' // The default prefix according to EIP-681 is "pay"
    }
    address = contractAddress
    const valid = EthereumUtil.isValidAddress(address || '')
    if (!valid) {
      throw new Error('InvalidPublicAddressError')
    }

    if (prefix === 'token' || prefix === 'token_info') {
      if (!parsedUri.query) throw new Error('InvalidUriError')

      const currencyCode = parsedUri.query.symbol || 'SYM'
      if (currencyCode.length < 2 || currencyCode.length > 5) {
        throw new Error('Wrong Token symbol')
      }
      const currencyName = parsedUri.query.name || currencyCode
      const decimalsInput = parsedUri.query.decimals || '18'
      let multiplier = '1000000000000000000'
      try {
        const decimals = parseInt(decimalsInput)
        if (decimals < 0 || decimals > 18) {
          throw new Error('Wrong number of decimals')
        }
        multiplier = '1' + '0'.repeat(decimals)
      } catch (e) {
        throw e
      }

      const type = parsedUri.query.type || 'ERC20'

      const edgeParsedUriToken: EdgeParsedUri = {
        token: {
          currencyCode,
          contractAddress,
          currencyName,
          multiplier,
          type: type.toUpperCase()
        }
      }
      return edgeParsedUriToken
    }
    return edgeParsedUri
  }

  async encodeUri (obj: EdgeEncodeUri): Promise<string> {
    const valid = EthereumUtil.isValidAddress(obj.publicAddress)
    if (!valid) {
      throw new Error('InvalidPublicAddressError')
    }
    let amount
    if (typeof obj.nativeAmount === 'string') {
      const nativeAmount: string = obj.nativeAmount
      const denom = getDenomInfo(currencyInfo, 'ETH')
      if (!denom) {
        throw new Error('InternalErrorInvalidCurrencyCode')
      }
      amount = bns.div(nativeAmount, denom.multiplier, 18)
    }
    const encodedUri = this.encodeUriCommon(obj, 'ethereum', amount)
    return encodedUri
  }
}

export function makeEthereumPlugin (
  opts: EdgeCorePluginOptions
): EdgeCurrencyPlugin {
  const { io, initOptions } = opts

  let toolsPromise: Promise<EthereumPlugin>
  function makeCurrencyTools (): Promise<EthereumPlugin> {
    if (toolsPromise != null) return toolsPromise
    toolsPromise = Promise.resolve(new EthereumPlugin(io))
    return toolsPromise
  }

  async function makeCurrencyEngine (
    walletInfo: EdgeWalletInfo,
    opts: EdgeCurrencyEngineOptions
  ): Promise<EdgeCurrencyEngine> {
    const tools = await makeCurrencyTools()
    const currencyEngine = new EthereumEngine(
      tools,
      walletInfo,
      initOptions,
      opts
    )

    // Do any async initialization necessary for the engine
    await currencyEngine.loadEngine(tools, walletInfo, opts)

    // This is just to make sure otherData is Flow type checked
    currencyEngine.otherData = currencyEngine.walletLocalData.otherData

    // Initialize otherData defaults if they weren't on disk
    if (!currencyEngine.otherData.nextNonce) {
      currencyEngine.otherData.nextNonce = '0'
    }
    if (!currencyEngine.otherData.networkFees) {
      currencyEngine.otherData.networkFees = defaultNetworkFees
    }

    const out: EdgeCurrencyEngine = currencyEngine
    return out
  }

  return {
    currencyInfo,
    makeCurrencyEngine,
    makeCurrencyTools
  }
}
