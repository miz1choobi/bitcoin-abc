// Copyright (c) 2021 The Bitcoin Core developers
// Distributed under the MIT software license, see the accompanying
// file COPYING or http://www.opensource.org/licenses/mit-license.php.

#include <txorphanage.h>

#include <consensus/validation.h>
#include <logging.h>
#include <policy/policy.h>

#include <cassert>

/** Expiration time for orphan transactions in seconds */
static constexpr int64_t ORPHAN_TX_EXPIRE_TIME = 20 * 60;
/** Minimum time between orphan transactions expire time checks in seconds */
static constexpr int64_t ORPHAN_TX_EXPIRE_INTERVAL = 5 * 60;

RecursiveMutex g_cs_orphans;

bool TxOrphanage::AddTx(const CTransactionRef &tx, NodeId peer) {
    AssertLockHeld(g_cs_orphans);

    const TxId &txid = tx->GetId();
    if (mapOrphanTransactions.count(txid)) {
        return false;
    }

    // Ignore big transactions, to avoid a send-big-orphans memory exhaustion
    // attack. If a peer has a legitimate large transaction with a missing
    // parent then we assume it will rebroadcast it later, after the parent
    // transaction(s) have been mined or received.
    // 100 orphans, each of which is at most 100,000 bytes big is at most 10
    // megabytes of orphans and somewhat more byprev index (in the worst case):
    unsigned int sz = tx->GetTotalSize();
    if (sz > MAX_STANDARD_TX_SIZE) {
        LogPrint(BCLog::MEMPOOL,
                 "ignoring large orphan tx (size: %u, hash: %s)\n", sz,
                 txid.ToString());
        return false;
    }

    auto ret = mapOrphanTransactions.emplace(
        txid, COrphanTx{tx, peer, GetTime() + ORPHAN_TX_EXPIRE_TIME,
                        g_orphan_list.size()});
    assert(ret.second);
    g_orphan_list.push_back(ret.first);
    for (const CTxIn &txin : tx->vin) {
        mapOrphanTransactionsByPrev[txin.prevout].insert(ret.first);
    }

    LogPrint(BCLog::MEMPOOL, "stored orphan tx %s (mapsz %u outsz %u)\n",
             txid.ToString(), mapOrphanTransactions.size(),
             mapOrphanTransactionsByPrev.size());
    return true;
}

int TxOrphanage::EraseTx(const TxId &txid) {
    AssertLockHeld(g_cs_orphans);
    std::map<TxId, COrphanTx>::iterator it = mapOrphanTransactions.find(txid);
    if (it == mapOrphanTransactions.end()) {
        return 0;
    }
    for (const CTxIn &txin : it->second.tx->vin) {
        auto itPrev = mapOrphanTransactionsByPrev.find(txin.prevout);
        if (itPrev == mapOrphanTransactionsByPrev.end()) {
            continue;
        }
        itPrev->second.erase(it);
        if (itPrev->second.empty()) {
            mapOrphanTransactionsByPrev.erase(itPrev);
        }
    }

    size_t old_pos = it->second.list_pos;
    assert(g_orphan_list[old_pos] == it);
    if (old_pos + 1 != g_orphan_list.size()) {
        // Unless we're deleting the last entry in g_orphan_list, move the last
        // entry to the position we're deleting.
        auto it_last = g_orphan_list.back();
        g_orphan_list[old_pos] = it_last;
        it_last->second.list_pos = old_pos;
    }
    g_orphan_list.pop_back();

    mapOrphanTransactions.erase(it);
    return 1;
}

void TxOrphanage::EraseForPeer(NodeId peer) {
    AssertLockHeld(g_cs_orphans);

    int nErased = 0;
    std::map<TxId, COrphanTx>::iterator iter = mapOrphanTransactions.begin();
    while (iter != mapOrphanTransactions.end()) {
        std::map<TxId, COrphanTx>::iterator maybeErase =
            iter++; // increment to avoid iterator becoming invalid
        if (maybeErase->second.fromPeer == peer) {
            nErased += EraseTx(maybeErase->second.tx->GetId());
        }
    }
    if (nErased > 0) {
        LogPrint(BCLog::MEMPOOL, "Erased %d orphan tx from peer=%d\n", nErased,
                 peer);
    }
}

unsigned int TxOrphanage::LimitOrphans(unsigned int nMaxOrphans) {
    AssertLockHeld(g_cs_orphans);

    unsigned int nEvicted = 0;
    static int64_t nNextSweep;
    int64_t nNow = GetTime();
    if (nNextSweep <= nNow) {
        // Sweep out expired orphan pool entries:
        int nErased = 0;
        int64_t nMinExpTime =
            nNow + ORPHAN_TX_EXPIRE_TIME - ORPHAN_TX_EXPIRE_INTERVAL;
        std::map<TxId, COrphanTx>::iterator iter =
            mapOrphanTransactions.begin();
        while (iter != mapOrphanTransactions.end()) {
            std::map<TxId, COrphanTx>::iterator maybeErase = iter++;
            if (maybeErase->second.nTimeExpire <= nNow) {
                nErased += EraseTx(maybeErase->second.tx->GetId());
            } else {
                nMinExpTime =
                    std::min(maybeErase->second.nTimeExpire, nMinExpTime);
            }
        }
        // Sweep again 5 minutes after the next entry that expires in order to
        // batch the linear scan.
        nNextSweep = nMinExpTime + ORPHAN_TX_EXPIRE_INTERVAL;
        if (nErased > 0) {
            LogPrint(BCLog::MEMPOOL, "Erased %d orphan tx due to expiration\n",
                     nErased);
        }
    }
    FastRandomContext rng;
    while (mapOrphanTransactions.size() > nMaxOrphans) {
        // Evict a random orphan:
        size_t randompos = rng.randrange(g_orphan_list.size());
        EraseTx(g_orphan_list[randompos]->first);
        ++nEvicted;
    }
    return nEvicted;
}

void TxOrphanage::AddChildrenToWorkSet(const CTransaction &tx,
                                       std::set<TxId> &orphan_work_set) const {
    AssertLockHeld(g_cs_orphans);
    for (size_t i = 0; i < tx.vout.size(); i++) {
        const auto it_by_prev =
            mapOrphanTransactionsByPrev.find(COutPoint(tx.GetId(), i));
        if (it_by_prev != mapOrphanTransactionsByPrev.end()) {
            for (const auto &elem : it_by_prev->second) {
                orphan_work_set.insert(elem->first);
            }
        }
    }
}

bool TxOrphanage::HaveTx(const TxId &txid) const {
    LOCK(g_cs_orphans);
    return mapOrphanTransactions.count(txid);
}

std::pair<CTransactionRef, NodeId> TxOrphanage::GetTx(const TxId &txid) const {
    AssertLockHeld(g_cs_orphans);

    const auto it = mapOrphanTransactions.find(txid);
    if (it == mapOrphanTransactions.end()) {
        return {nullptr, -1};
    }
    return {it->second.tx, it->second.fromPeer};
}

void TxOrphanage::EraseForBlock(const CBlock &block) {
    LOCK(g_cs_orphans);

    std::vector<TxId> vOrphanErase;

    for (const CTransactionRef &ptx : block.vtx) {
        const CTransaction &tx = *ptx;

        // Which orphan pool entries must we evict?
        for (const auto &txin : tx.vin) {
            auto itByPrev = mapOrphanTransactionsByPrev.find(txin.prevout);
            if (itByPrev == mapOrphanTransactionsByPrev.end()) {
                continue;
            }

            for (auto mi = itByPrev->second.begin();
                 mi != itByPrev->second.end(); ++mi) {
                const CTransaction &orphanTx = *(*mi)->second.tx;
                const TxId &orphanId = orphanTx.GetId();
                vOrphanErase.push_back(orphanId);
            }
        }
    }

    // Erase orphan transactions included or precluded by this block
    if (vOrphanErase.size()) {
        int nErased = 0;
        for (const auto &orphanId : vOrphanErase) {
            nErased += EraseTx(orphanId);
        }
        LogPrint(BCLog::MEMPOOL,
                 "Erased %d orphan tx included or conflicted by block\n",
                 nErased);
    }
}