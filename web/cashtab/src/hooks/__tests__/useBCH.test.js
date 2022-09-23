/* eslint-disable no-native-reassign */
import useBCH from '../useBCH';
import sendBCHMock from '../__mocks__/sendBCH';
import createTokenMock from '../__mocks__/createToken';
import mockTxHistory from '../__mocks__/mockTxHistory';
import mockFlatTxHistory from '../__mocks__/mockFlatTxHistory';
import mockTxDataWithPassthrough from '../__mocks__/mockTxDataWithPassthrough';
import mockPublicKeys from '../__mocks__/mockPublicKeys';
import {
    tokenSendWdt,
    tokenReceiveGarmonbozia,
    tokenReceiveTBS,
    tokenGenesisCashtabMintAlpha,
} from '../__mocks__/mockParseTokenInfoForTxHistory';
import {
    mockSentCashTx,
    mockReceivedCashTx,
    mockSentTokenTx,
    mockReceivedTokenTx,
    mockSentOpReturnMessageTx,
    mockReceivedOpReturnMessageTx,
    mockBurnEtokenTx,
    mockSentAirdropOpReturnMessageTx,
} from '../__mocks__/mockParsedTxs';
import {
    mockReceivedXecTxRawTx,
    mockBurnEtokenTxRawTx,
    mockReceivedEtokenTxRawTx,
} from '../__mocks__/mockParseTxDataRawTxs';
import { validStoredWallet } from '../../utils/__mocks__/mockStoredWallets';
import BCHJS from '@psf/bch-js'; // TODO: should be removed when external lib not needed anymore
import { currency } from '../../components/Common/Ticker';
import BigNumber from 'bignumber.js';
import { fromSatoshisToXec } from 'utils/cashMethods';
import { ChronikClient } from 'chronik-client'; // for mocking purposes
import { when } from 'jest-when';

describe('useBCH hook', () => {
    it('gets Rest Api Url on testnet', () => {
        process = {
            env: {
                REACT_APP_NETWORK: `testnet`,
                REACT_APP_BCHA_APIS:
                    'https://rest.kingbch.com/v3/,https://wallet-service-prod.bitframe.org/v3/,notevenaurl,https://rest.kingbch.com/v3/',
                REACT_APP_BCHA_APIS_TEST:
                    'https://free-test.fullstack.cash/v3/',
            },
        };
        const { getRestUrl } = useBCH();
        const expectedApiUrl = `https://free-test.fullstack.cash/v3/`;
        expect(getRestUrl(0)).toBe(expectedApiUrl);
    });

    it('gets primary Rest API URL on mainnet', () => {
        process = {
            env: {
                REACT_APP_BCHA_APIS:
                    'https://rest.kingbch.com/v3/,https://wallet-service-prod.bitframe.org/v3/,notevenaurl,https://rest.kingbch.com/v3/',
                REACT_APP_NETWORK: 'mainnet',
            },
        };
        const { getRestUrl } = useBCH();
        const expectedApiUrl = `https://rest.kingbch.com/v3/`;
        expect(getRestUrl(0)).toBe(expectedApiUrl);
    });

    it('calculates fee correctly for 2 P2PKH outputs', () => {
        const { calcFee } = useBCH();
        const BCH = new BCHJS();
        const utxosMock = [{}, {}];

        expect(calcFee(BCH, utxosMock, 2, 1.01)).toBe(378);
    });

    it('sends XEC correctly', async () => {
        const { sendXec } = useBCH();
        const BCH = new BCHJS();
        const chronik = new ChronikClient(
            'https://FakeChronikUrlToEnsureMocksOnly.com',
        );
        const {
            expectedTxId,
            expectedHex,
            utxos,
            wallet,
            destinationAddress,
            sendAmount,
        } = sendBCHMock;

        chronik.broadcastTx = jest
            .fn()
            .mockResolvedValue({ txid: expectedTxId });
        expect(
            await sendXec(
                BCH,
                chronik,
                wallet,
                utxos,
                currency.defaultFee,
                '',
                false,
                null,
                destinationAddress,
                sendAmount,
            ),
        ).toBe(`${currency.blockExplorerUrl}/tx/${expectedTxId}`);
    });

    it('sends XEC correctly with an encrypted OP_RETURN message', async () => {
        const { sendXec } = useBCH();
        const BCH = new BCHJS();
        const chronik = new ChronikClient(
            'https://FakeChronikUrlToEnsureMocksOnly.com',
        );
        const { expectedTxId, utxos, wallet, destinationAddress, sendAmount } =
            sendBCHMock;
        const expectedPubKeyResponse = {
            success: true,
            publicKey:
                '03451a3e61ae8eb76b8d4cd6057e4ebaf3ef63ae3fe5f441b72c743b5810b6a389',
        };

        BCH.encryption.getPubKey = jest
            .fn()
            .mockResolvedValue(expectedPubKeyResponse);

        chronik.broadcastTx = jest
            .fn()
            .mockResolvedValue({ txid: expectedTxId });
        expect(
            await sendXec(
                BCH,
                chronik,
                wallet,
                utxos,
                currency.defaultFee,
                'This is an encrypted opreturn message',
                false,
                null,
                destinationAddress,
                sendAmount,
                true, // encryption flag for the OP_RETURN message
            ),
        ).toBe(`${currency.blockExplorerUrl}/tx/${expectedTxId}`);
    });

    it('sends one to many XEC correctly', async () => {
        const { sendXec } = useBCH();
        const BCH = new BCHJS();
        const chronik = new ChronikClient(
            'https://FakeChronikUrlToEnsureMocksOnly.com',
        );
        const {
            expectedTxId,
            expectedHex,
            utxos,
            wallet,
            destinationAddress,
            sendAmount,
        } = sendBCHMock;

        const addressAndValueArray = [
            'bitcoincash:qrzuvj0vvnsz5949h4axercl5k420eygavv0awgz05,6',
            'bitcoincash:qrzuvj0vvnsz5949h4axercl5k420eygavv0awgz05,6.8',
            'bitcoincash:qrzuvj0vvnsz5949h4axercl5k420eygavv0awgz05,7',
            'bitcoincash:qrzuvj0vvnsz5949h4axercl5k420eygavv0awgz05,6',
        ];

        chronik.broadcastTx = jest
            .fn()
            .mockResolvedValue({ txid: expectedTxId });
        expect(
            await sendXec(
                BCH,
                chronik,
                wallet,
                utxos,
                currency.defaultFee,
                '',
                true,
                addressAndValueArray,
            ),
        ).toBe(`${currency.blockExplorerUrl}/tx/${expectedTxId}`);
    });

    it(`Throws error if called trying to send one base unit ${currency.ticker} more than available in utxo set`, async () => {
        const { sendXec } = useBCH();
        const BCH = new BCHJS();
        const chronik = new ChronikClient(
            'https://FakeChronikUrlToEnsureMocksOnly.com',
        );
        const { expectedTxId, utxos, wallet, destinationAddress } = sendBCHMock;

        const expectedTxFeeInSats = 229;

        // tally up the total utxo values
        let totalInputUtxoValue = new BigNumber(0);
        for (let i = 0; i < utxos.length; i++) {
            totalInputUtxoValue = totalInputUtxoValue.plus(
                new BigNumber(utxos[i].value),
            );
        }

        const oneBaseUnitMoreThanBalance = totalInputUtxoValue
            .minus(expectedTxFeeInSats)
            .plus(1)
            .div(10 ** currency.cashDecimals)
            .toString();

        let errorThrown;
        try {
            await sendXec(
                BCH,
                chronik,
                wallet,
                utxos,
                currency.defaultFee,
                '',
                false,
                null,
                destinationAddress,
                oneBaseUnitMoreThanBalance,
            );
        } catch (err) {
            errorThrown = err;
        }
        expect(errorThrown.message).toStrictEqual('Insufficient funds');

        const nullValuesSendBch = sendXec(
            BCH,
            chronik,
            wallet,
            utxos,
            currency.defaultFee,
            '',
            false,
            null,
            destinationAddress,
            null,
        );
        expect(nullValuesSendBch).rejects.toThrow(
            new Error('Invalid singleSendValue'),
        );
    });

    it('Throws error on attempt to send one satoshi less than backend dust limit', async () => {
        const { sendXec } = useBCH();
        const BCH = new BCHJS();
        const chronik = new ChronikClient(
            'https://FakeChronikUrlToEnsureMocksOnly.com',
        );
        const { expectedTxId, utxos, wallet, destinationAddress } = sendBCHMock;
        const failedSendBch = sendXec(
            BCH,
            chronik,
            wallet,
            utxos,
            currency.defaultFee,
            '',
            false,
            null,
            destinationAddress,
            new BigNumber(fromSatoshisToXec(currency.dustSats).toString())
                .minus(new BigNumber('0.00000001'))
                .toString(),
        );
        expect(failedSendBch).rejects.toThrow(new Error('dust'));
    });

    it("Throws error attempting to burn an eToken ID that is not within the wallet's utxo", async () => {
        const { burnToken } = useBCH();
        const BCH = new BCHJS();
        const wallet = validStoredWallet;
        const burnAmount = 10;
        const eTokenId = '0203c768a66eba24affNOTVALID103b772de4d9f8f63ba79e';
        const expectedError =
            'No token UTXOs for the specified token could be found.';

        let thrownError;
        try {
            await burnToken(BCH, wallet, {
                eTokenId,
                burnAmount,
            });
        } catch (err) {
            thrownError = err;
        }
        expect(thrownError).toStrictEqual(new Error(expectedError));
    });

    it('receives errors from the network and parses it', async () => {
        const { sendXec } = useBCH();
        const BCH = new BCHJS();
        const chronik = new ChronikClient(
            'https://FakeChronikUrlToEnsureMocksOnly.com',
        );
        const { sendAmount, utxos, wallet, destinationAddress } = sendBCHMock;
        chronik.broadcastTx = jest.fn().mockImplementation(async () => {
            throw new Error('insufficient priority (code 66)');
        });
        const insufficientPriority = sendXec(
            BCH,
            chronik,
            wallet,
            utxos,
            currency.defaultFee,
            '',
            false,
            null,
            destinationAddress,
            sendAmount,
        );
        await expect(insufficientPriority).rejects.toThrow(
            new Error('insufficient priority (code 66)'),
        );

        chronik.broadcastTx = jest.fn().mockImplementation(async () => {
            throw new Error('txn-mempool-conflict (code 18)');
        });
        const txnMempoolConflict = sendXec(
            BCH,
            chronik,
            wallet,
            utxos,
            currency.defaultFee,
            '',
            false,
            null,
            destinationAddress,
            sendAmount,
        );
        await expect(txnMempoolConflict).rejects.toThrow(
            new Error('txn-mempool-conflict (code 18)'),
        );

        chronik.broadcastTx = jest.fn().mockImplementation(async () => {
            throw new Error('Network Error');
        });
        const networkError = sendXec(
            BCH,
            chronik,
            wallet,
            utxos,
            currency.defaultFee,
            '',
            false,
            null,
            destinationAddress,
            sendAmount,
        );
        await expect(networkError).rejects.toThrow(new Error('Network Error'));

        chronik.broadcastTx = jest.fn().mockImplementation(async () => {
            const err = new Error(
                'too-long-mempool-chain, too many unconfirmed ancestors [limit: 25] (code 64)',
            );
            throw err;
        });

        const tooManyAncestorsMempool = sendXec(
            BCH,
            chronik,
            wallet,
            utxos,
            currency.defaultFee,
            '',
            false,
            null,
            destinationAddress,
            sendAmount,
        );
        await expect(tooManyAncestorsMempool).rejects.toThrow(
            new Error(
                'too-long-mempool-chain, too many unconfirmed ancestors [limit: 25] (code 64)',
            ),
        );
    });

    it('creates a token correctly', async () => {
        const { createToken } = useBCH();
        const BCH = new BCHJS();
        const { expectedTxId, expectedHex, wallet, configObj } =
            createTokenMock;

        BCH.RawTransactions.sendRawTransaction = jest
            .fn()
            .mockResolvedValue(expectedTxId);
        expect(await createToken(BCH, wallet, 5.01, configObj)).toBe(
            `${currency.blockExplorerUrl}/tx/${expectedTxId}`,
        );
        expect(BCH.RawTransactions.sendRawTransaction).toHaveBeenCalledWith(
            expectedHex,
        );
    });

    it('Throws correct error if user attempts to create a token with an invalid wallet', async () => {
        const { createToken } = useBCH();
        const BCH = new BCHJS();
        const { invalidWallet, configObj } = createTokenMock;

        const invalidWalletTokenCreation = createToken(
            BCH,
            invalidWallet,
            currency.defaultFee,
            configObj,
        );
        await expect(invalidWalletTokenCreation).rejects.toThrow(
            new Error('Invalid wallet'),
        );
    });

    it('Correctly flattens transaction history', () => {
        const { flattenTransactions } = useBCH();
        expect(flattenTransactions(mockTxHistory, 10)).toStrictEqual(
            mockFlatTxHistory,
        );
    });

    it(`Correctly parses a "send ${currency.ticker}" transaction`, async () => {
        const { parseTxData } = useBCH();
        const BCH = new BCHJS();
        expect(
            await parseTxData(
                BCH,
                [mockTxDataWithPassthrough[0]],
                mockPublicKeys,
            ),
        ).toStrictEqual(mockSentCashTx);
    });

    it(`Correctly parses a "receive ${currency.ticker}" transaction`, async () => {
        const { parseTxData } = useBCH();
        const BCH = new BCHJS();
        BCH.RawTransactions.getRawTransaction = jest
            .fn()
            .mockResolvedValue(mockReceivedXecTxRawTx);
        expect(
            await parseTxData(
                BCH,
                [mockTxDataWithPassthrough[5]],
                mockPublicKeys,
            ),
        ).toStrictEqual(mockReceivedCashTx);
    });

    it(`Correctly parses a "send ${currency.tokenTicker}" transaction`, async () => {
        const { parseTxData } = useBCH();
        const BCH = new BCHJS();
        expect(
            await parseTxData(
                BCH,
                [mockTxDataWithPassthrough[1]],
                mockPublicKeys,
            ),
        ).toStrictEqual(mockSentTokenTx);
    });

    it(`Correctly parses a "burn ${currency.tokenTicker}" transaction`, async () => {
        const { parseTxData } = useBCH();
        const BCH = new BCHJS();
        BCH.RawTransactions.getRawTransaction = jest
            .fn()
            .mockResolvedValue(mockBurnEtokenTxRawTx);

        expect(
            await parseTxData(
                BCH,
                [mockTxDataWithPassthrough[13]],
                mockPublicKeys,
            ),
        ).toStrictEqual(mockBurnEtokenTx);
    });

    it(`Correctly parses a "receive ${currency.tokenTicker}" transaction`, async () => {
        const { parseTxData } = useBCH();
        const BCH = new BCHJS();
        BCH.RawTransactions.getRawTransaction = jest
            .fn()
            .mockResolvedValue(mockReceivedEtokenTxRawTx);
        expect(
            await parseTxData(
                BCH,
                [mockTxDataWithPassthrough[3]],
                mockPublicKeys,
            ),
        ).toStrictEqual(mockReceivedTokenTx);
    });

    it(`Correctly parses a "send ${currency.tokenTicker}" transaction with token details`, () => {
        const { parseTokenInfoForTxHistory } = useBCH();
        const BCH = new BCHJS();
        expect(
            parseTokenInfoForTxHistory(
                BCH,
                tokenSendWdt.parsedTx,
                tokenSendWdt.tokenInfo,
            ),
        ).toStrictEqual(tokenSendWdt.cashtabTokenInfo);
    });

    it(`Correctly parses a "receive ${currency.tokenTicker}" transaction with token details and 9 decimals of precision`, () => {
        const { parseTokenInfoForTxHistory } = useBCH();
        const BCH = new BCHJS();
        expect(
            parseTokenInfoForTxHistory(
                BCH,
                tokenReceiveTBS.parsedTx,
                tokenReceiveTBS.tokenInfo,
            ),
        ).toStrictEqual(tokenReceiveTBS.cashtabTokenInfo);
    });

    it(`Correctly parses a "receive ${currency.tokenTicker}" transaction from an HD wallet (change address different from sending address)`, () => {
        const { parseTokenInfoForTxHistory } = useBCH();
        const BCH = new BCHJS();
        expect(
            parseTokenInfoForTxHistory(
                BCH,
                tokenReceiveGarmonbozia.parsedTx,
                tokenReceiveGarmonbozia.tokenInfo,
            ),
        ).toStrictEqual(tokenReceiveGarmonbozia.cashtabTokenInfo);
    });

    it(`Correctly parses a "GENESIS ${currency.tokenTicker}" transaction with token details`, () => {
        const { parseTokenInfoForTxHistory } = useBCH();
        const BCH = new BCHJS();
        expect(
            parseTokenInfoForTxHistory(
                BCH,
                tokenGenesisCashtabMintAlpha.parsedTx,
                tokenGenesisCashtabMintAlpha.tokenInfo,
            ),
        ).toStrictEqual(tokenGenesisCashtabMintAlpha.cashtabTokenInfo);
    });

    it(`Correctly parses a "send ${currency.ticker}" transaction with an OP_RETURN message`, async () => {
        const { parseTxData } = useBCH();
        const BCH = new BCHJS();
        BCH.RawTransactions.getRawTransaction = jest
            .fn()
            .mockResolvedValue(mockTxDataWithPassthrough[14]);
        expect(
            await parseTxData(
                BCH,
                [mockTxDataWithPassthrough[10]],
                mockPublicKeys,
            ),
        ).toStrictEqual(mockSentOpReturnMessageTx);
    });

    it(`Correctly parses a "send ${currency.ticker}" airdrop transaction with an OP_RETURN message`, async () => {
        const { parseTxData } = useBCH();
        const BCH = new BCHJS();
        BCH.RawTransactions.getRawTransaction = jest
            .fn()
            .mockResolvedValue(mockTxDataWithPassthrough[15]);
        expect(
            await parseTxData(
                BCH,
                [mockTxDataWithPassthrough[15]],
                mockPublicKeys,
            ),
        ).toStrictEqual(mockSentAirdropOpReturnMessageTx);
    });

    it(`Correctly parses a "receive ${currency.ticker}" transaction with an OP_RETURN message`, async () => {
        const { parseTxData } = useBCH();
        const BCH = new BCHJS();
        BCH.RawTransactions.getRawTransaction = jest
            .fn()
            .mockResolvedValue(mockTxDataWithPassthrough[12]);
        expect(
            await parseTxData(
                BCH,
                [mockTxDataWithPassthrough[11]],
                mockPublicKeys,
            ),
        ).toStrictEqual(mockReceivedOpReturnMessageTx);
    });

    it(`handleEncryptedOpReturn() correctly encrypts a message based on a valid cash address`, async () => {
        const { handleEncryptedOpReturn } = useBCH();
        const BCH = new BCHJS();
        const destinationAddress =
            'bitcoincash:qqvuj09f80sw9j7qru84ptxf0hyqffc38gstxfs5ru';
        const message =
            'This message is encrypted by ecies-lite with default parameters';

        const expectedPubKeyResponse = {
            success: true,
            publicKey:
                '03208c4f52229e021ddec5fc6e07a59fd66388ac52bc2a2c1e0f1afb24b0e275ac',
        };

        BCH.encryption.getPubKey = jest
            .fn()
            .mockResolvedValue(expectedPubKeyResponse);

        const result = await handleEncryptedOpReturn(
            BCH,
            destinationAddress,
            Buffer.from(message),
        );

        // loop through each ecies encryption parameter from the object returned from the handleEncryptedOpReturn() call
        for (const k of Object.keys(result)) {
            switch (result[k].toString()) {
                case 'epk':
                    // verify the sender's ephemeral public key buffer
                    expect(result[k].toString()).toEqual(
                        'BPxEy0o7QsRok2GSpuLU27g0EqLIhf6LIxHx7P5UTZF9EFuQbqGzr5cCA51qVnvIJ9CZ84iW1DeDdvhg/EfPSas=',
                    );
                    break;
                case 'iv':
                    // verify the initialization vector for the cipher algorithm
                    expect(result[k].toString()).toEqual(
                        '2FcU3fRZUOBt7dqshZjd+g==',
                    );
                    break;
                case 'ct':
                    // verify the encrypted message buffer
                    expect(result[k].toString()).toEqual(
                        'wVxPjv/ZiQ4etHqqTTIEoKvYYf4po05I/kNySrdsN3verxlHI07Rbob/VfF4MDfYHpYmDwlR9ax1shhdSzUG/A==',
                    );
                    break;
                case 'mac':
                    // verify integrity of the message (checksum)
                    expect(result[k].toString()).toEqual(
                        'F9KxuR48O0wxa9tFYq6/Hy3joI2edKxLFSeDVk6JKZE=',
                    );
                    break;
            }
        }
    });

    it(`getRecipientPublicKey() correctly retrieves the public key of a cash address`, async () => {
        const { getRecipientPublicKey } = useBCH();
        const BCH = new BCHJS();
        const expectedPubKeyResponse = {
            success: true,
            publicKey:
                '03208c4f52229e021ddec5fc6e07a59fd66388ac52bc2a2c1e0f1afb24b0e275ac',
        };
        const expectedPubKey =
            '03208c4f52229e021ddec5fc6e07a59fd66388ac52bc2a2c1e0f1afb24b0e275ac';
        const destinationAddress =
            'bitcoincash:qqvuj09f80sw9j7qru84ptxf0hyqffc38gstxfs5ru';
        BCH.encryption.getPubKey = jest
            .fn()
            .mockResolvedValue(expectedPubKeyResponse);
        expect(await getRecipientPublicKey(BCH, destinationAddress)).toBe(
            expectedPubKey,
        );
    });
});
