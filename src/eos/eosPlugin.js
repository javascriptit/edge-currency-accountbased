/**
 * Created by paul on 8/8/17.
 */
// @flow
import { currencyInfo } from './eosInfo.js'
import { makeEngineCommon, parseUriCommon, encodeUriCommon } from '../common/plugin.js'
import type {
  EdgeCurrencyEngine,
  EdgeCurrencyEngineOptions,
  EdgeEncodeUri,
  EdgeCurrencyPlugin,
  EdgeCurrencyPluginFactory,
  EdgeWalletInfo
} from 'edge-core-js'
import { EosEngine } from './eosEngine'
import { bns } from 'biggystring'
let io

function getDenomInfo (denom: string) {
  return currencyInfo.denominations.find(element => {
    return element.name === denom
  })
}

function checkAddress (address: string): boolean {
  if (address.length !== 12) {
    return false
  }
  // const chars = '.12345abcdefghijklmnopqrstuvwxyz'
  // TODO: Check address for each of characters in `chars`
  return true
}

export const eosCurrencyPluginFactory: EdgeCurrencyPluginFactory = {
  pluginType: 'currency',
  pluginName: currencyInfo.pluginName,

  async makePlugin (opts: any): Promise<EdgeCurrencyPlugin> {
    io = opts.io

    // TODO: Initialize currency library if needed
    return {
      pluginName: 'eos',
      currencyInfo,

      createPrivateKey: (walletType: string) => {
        const type = walletType.replace('wallet:', '')

        if (type === 'eos') {
          // TODO: User currency library to create private key

          return { }
        } else {
          throw new Error('InvalidWalletType')
        }
      },

      derivePublicKey: (walletInfo: EdgeWalletInfo) => {
        const type = walletInfo.type.replace('wallet:', '')
        if (type === 'eos') {
          // TODO: User currency library to create private key
          // const displayAddress = keypairs.deriveAddress(keypair.publicKey)
          return { }
        } else {
          throw new Error('InvalidWalletType')
        }
      },

      async makeEngine (walletInfo: EdgeWalletInfo, opts: EdgeCurrencyEngineOptions): Promise<EdgeCurrencyEngine> {
        const currencyEngine = new EosEngine(this, io, walletInfo, opts)
        await makeEngineCommon(currencyEngine, this, io, walletInfo, opts)

        // TODO: Initialize anything specific to this currency
        const out: EdgeCurrencyEngine = currencyEngine
        return out
      },

      parseUri: (uri: string) => {
        const { parsedUri, edgeParsedUri } = parseUriCommon(uri, {
          'eos': true
        })
        let nativeAmount: string | null = null
        let currencyCode: string | null = null

        const amountStr = parsedUri.query.amount
        if (amountStr && typeof amountStr === 'string') {
          const denom = getDenomInfo('EOS')
          if (!denom) {
            throw new Error('InternalErrorInvalidCurrencyCode')
          }
          nativeAmount = bns.mul(amountStr, denom.multiplier)
          nativeAmount = bns.toFixed(nativeAmount, 0, 0)
          currencyCode = 'EOS'

          edgeParsedUri.nativeAmount = nativeAmount || undefined
          edgeParsedUri.currencyCode = currencyCode || undefined
        }
        const valid = checkAddress(edgeParsedUri.publicAddress || '')
        if (!valid) {
          throw new Error('InvalidPublicAddressError')
        }

        edgeParsedUri.uniqueIdentifier = parsedUri.query.tag || undefined
        return edgeParsedUri
      },

      encodeUri: (obj: EdgeEncodeUri) => {
        const valid = checkAddress(obj.publicAddress)
        if (!valid) {
          throw new Error('InvalidPublicAddressError')
        }
        let amount
        if (typeof obj.nativeAmount === 'string') {
          let currencyCode: string = 'EOS'
          const nativeAmount: string = obj.nativeAmount
          if (typeof obj.currencyCode === 'string') {
            currencyCode = obj.currencyCode
          }
          const denom = getDenomInfo(currencyCode)
          if (!denom) {
            throw new Error('InternalErrorInvalidCurrencyCode')
          }
          amount = bns.div(nativeAmount, denom.multiplier, 18)
        }
        const encodedUri = encodeUriCommon(obj, 'eos', amount)
        return encodedUri
      }
    }
  }
}
