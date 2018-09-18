/**
 * Created by paul on 8/8/17.
 */
// @flow
import { currencyInfo } from './xrpInfo.js'
import { makeEngineCommon, parseUriCommon, encodeUriCommon } from '../common/plugin.js'
import type {
  EdgeCurrencyEngine,
  EdgeCurrencyEngineOptions,
  EdgeEncodeUri,
  EdgeCurrencyPlugin,
  EdgeCurrencyPluginFactory,
  EdgeWalletInfo
} from 'edge-core-js'
import { RippleAPI } from 'edge-ripple-lib'
import { XrpEngine } from './xrpEngine.js'
import { bns } from 'biggystring'
import baseX from 'base-x'
import keypairs from 'edge-ripple-keypairs'

const base58Codec = baseX(
  '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
)

let io

function getDenomInfo (denom: string) {
  return currencyInfo.denominations.find(element => {
    return element.name === denom
  })
}

function checkAddress (address: string): boolean {
  let data: Uint8Array
  try {
    data = base58Codec.decode(address)
  } catch (e) {
    return false
  }

  return data.length === 25 && address.charAt(0) === 'r'
}

export const rippleCurrencyPluginFactory: EdgeCurrencyPluginFactory = {
  pluginType: 'currency',
  pluginName: currencyInfo.pluginName,

  async makePlugin (opts: any): Promise<EdgeCurrencyPlugin> {
    io = opts.io

    const rippleApi = new RippleAPI({
      server: currencyInfo.defaultSettings.otherSettings.rippledServers[0] // Public rippled server
    })

    return {
      pluginName: 'ripple',
      currencyInfo,

      createPrivateKey: (walletType: string) => {
        const type = walletType.replace('wallet:', '')

        if (type === 'ripple' || type === 'ripple-secp256k1') {
          const algorithm = type === 'ripple-secp256k1' ? 'ecdsa-secp256k1' : 'ed25519'
          const entropy = Array.from(io.random(32))
          const address = rippleApi.generateAddress({
            algorithm,
            entropy
          })

          return { rippleKey: address.secret }
        } else {
          throw new Error('InvalidWalletType')
        }
      },

      derivePublicKey: (walletInfo: EdgeWalletInfo) => {
        const type = walletInfo.type.replace('wallet:', '')
        if (type === 'ripple' || type === 'ripple-secp256k1') {
          const keypair = keypairs.deriveKeypair(walletInfo.keys.rippleKey)
          const displayAddress = keypairs.deriveAddress(keypair.publicKey)
          return { displayAddress }
        } else {
          throw new Error('InvalidWalletType')
        }
      },

      async makeEngine (walletInfo: EdgeWalletInfo, opts: EdgeCurrencyEngineOptions): Promise<EdgeCurrencyEngine> {
        const currencyEngine = new XrpEngine(this, io, walletInfo, opts)

        // XRP specific
        currencyEngine.walletLocalData.otherData.recommendedFee = '0'
        currencyEngine.rippleApi = rippleApi

        await makeEngineCommon(currencyEngine, this, io, walletInfo, opts)

        // TODO: Initialize anything specific to this currency

        const out: EdgeCurrencyEngine = currencyEngine
        return out
      },

      parseUri: (uri: string) => {
        const networks = { 'ripple': true }
        let { parsedUri, edgeParsedUri } = parseUriCommon(uri, networks)

        // Handle special case of https://ripple.com//send?to= URIs
        if (
          parsedUri.protocol === 'https:' &&
          parsedUri.host === 'ripple.com' &&
          parsedUri.pathname === '//send') {
          // Parse "https://ripple.com//send?to=" format URI
          const toStr = parsedUri.query.to
          if (toStr) {
            // Redo parse
            uri = uri.replace('https://ripple.com//send', `ripple:${toStr}`)
            const results = parseUriCommon(uri, networks)
            parsedUri = results.parsedUri
            edgeParsedUri = results.edgeParsedUri
          } else {
            throw new Error('InvalidUriError')
          }
        }

        let nativeAmount: string | null = null
        let currencyCode: string | null = null

        const amountStr = parsedUri.query.amount
        if (amountStr && typeof amountStr === 'string') {
          const denom = getDenomInfo('XRP')
          if (!denom) {
            throw new Error('InternalErrorInvalidCurrencyCode')
          }
          nativeAmount = bns.mul(amountStr, denom.multiplier)
          nativeAmount = bns.toFixed(nativeAmount, 0, 0)
          currencyCode = 'XRP'

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
          let currencyCode: string = 'XRP'
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
        const encodedUri = encodeUriCommon(obj, 'ripple', amount)
        return encodedUri
      }
    }
  }
}
