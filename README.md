# DisasterAidChain

## Overview

DisasterAidChain is a Web3 project built on the Stacks blockchain using Clarity smart contracts. It enables rapid, transparent, and direct financial aid to disaster victims based on their verified needs. Donors can contribute funds (in STX or wrapped tokens), victims register and prove their needs through decentralized oracles, and blockchain ensures that aid reaches the intended recipients without intermediaries. This solves real-world problems like delays in traditional relief efforts, corruption in fund distribution, and lack of transparency in humanitarian aid.

The platform leverages blockchain for:
- **Speed**: Instant transfers via smart contracts.
- **Transparency**: All transactions and claims are on-chain and auditable.
- **Need-Based Allocation**: Funds are disbursed proportionally to verified needs (e.g., food, shelter, medical).
- **Decentralization**: No central authority; governed by a DAO.

This project addresses issues in disaster response, such as those seen in events like hurricanes, earthquakes, or floods, where aid often takes weeks to arrive and may not match victims' specific needs.

## How It Works

1. **Donations**: Users donate STX to a pooled fund.
2. **Victim Registration**: Victims register with proof of identity/location (via oracles).
3. **Needs Assessment**: Victims submit needs (e.g., quantified in categories), verified by oracles.
4. **Claim Processing**: Smart contracts evaluate claims against available funds.
5. **Distribution**: Funds are automatically sent to victims' wallets.
6. **Governance**: Token holders vote on parameters like oracle selection or fund allocation rules.
7. **Oracle Integration**: External data feeds confirm disasters and needs.

The system uses 6 core smart contracts for modularity, security, and scalability.

## Smart Contracts

All contracts are written in Clarity, the secure, decidable language for Stacks. They interact via contract calls for composability. Below is an overview and sample code for each. In a real deployment, these would be deployed separately and linked by principal addresses.

### 1. DonationPool.clar
Manages incoming donations and pools funds. Tracks total funds and donor contributions.

```clarity
;; DonationPool Contract
(define-constant contract-owner tx-sender)
(define-data-var total-funds u128 0)
(define-map donor-contributions principal u128)

(define-public (donate (amount u128))
  (begin
    (try! (stx-transfer? amount tx-sender (as-contract tx-sender)))
    (var-set total-funds (+ (var-get total-funds) amount))
    (map-set donor-contributions tx-sender (+ (default-to u0 (map-get? donor-contributions tx-sender)) amount))
    (ok amount)
  )
)

(define-read-only (get-total-funds)
  (ok (var-get total-funds))
)

(define-read-only (get-donor-contribution (donor principal))
  (ok (default-to u0 (map-get? donor-contributions donor)))
)
```

### 2. VictimRegistry.clar
Registers victims with basic info and verifies eligibility via oracle calls.

```clarity
;; VictimRegistry Contract
(define-map victims principal { registered: bool, verified: bool })
(define-constant oracle-contract 'SP1234567890ABCDEF.oracle) ;; Placeholder for oracle principal

(define-public (register-victim)
  (begin
    (map-set victims tx-sender { registered: true, verified: false })
    (ok true)
  )
)

(define-public (verify-victim (victim principal))
  (let ((oracle-response (contract-call? oracle-contract is-victim-affected victim)))
    (match oracle-response
      success (begin
        (map-set victims victim { registered: true, verified: true })
        (ok true))
      error (err u100) ;; Verification failed
    )
  )
)

(define-read-only (is-verified (victim principal))
  (ok (get verified (default-to { registered: false, verified: false } (map-get? victims victim))))
)
```

### 3. NeedsAssessment.clar
Allows verified victims to submit needs (categorized and quantified) and stores them.

```clarity
;; NeedsAssessment Contract
(define-map victim-needs principal { food: u64, shelter: u64, medical: u64, total-need: u64 })
(define-constant max-need-per-category u1000) ;; Arbitrary cap to prevent abuse

(define-public (submit-needs (food u64) (shelter u64) (medical u64))
  (let ((total (+ food shelter medical)))
    (asserts! (and (<= food max-need-per-category) (<= shelter max-need-per-category) (<= medical max-need-per-category)) (err u101))
    (asserts! (is-eq (contract-call? .victim-registry is-verified tx-sender) (ok true)) (err u102))
    (map-set victim-needs tx-sender { food: food, shelter: shelter, medical: medical, total-need: total })
    (ok total)
  )
)

(define-read-only (get-needs (victim principal))
  (ok (default-to { food: u0, shelter: u0, medical: u0, total-need: u0 } (map-get? victim-needs victim)))
)
```

### 4. ClaimProcessing.clar
Processes claims by evaluating needs against available funds and approving distributions.

```clarity
;; ClaimProcessing Contract
(define-map claims principal { amount: u128, approved: bool })
(define-data-var claim-window-open bool true)

(define-public (submit-claim)
  (let ((needs (unwrap! (contract-call? .needs-assessment get-needs tx-sender) (err u103)))
        (total-funds (unwrap! (contract-call? .donation-pool get-total-funds) (err u104)))
        (claim-amount (/ (* (get total-need needs) total-funds) u10000))) ;; Simplified proportional allocation
    (asserts! (var-get claim-window-open) (err u105))
    (map-set claims tx-sender { amount: claim-amount, approved: false })
    (ok claim-amount)
  )
)

(define-public (approve-claim (victim principal))
  (begin
    (asserts! (is-eq tx-sender (contract-call? .governance get-admin)) (err u106)) ;; Only governance can approve
    (map-set claims victim { amount: (get amount (unwrap! (map-get? claims victim) (err u107))), approved: true })
    (ok true)
  )
)

(define-read-only (get-claim (victim principal))
  (ok (default-to { amount: u0, approved: false } (map-get? claims victim)))
)
```

### 5. FundDistribution.clar
Handles the actual disbursement of funds to approved claims.

```clarity
;; FundDistribution Contract
(define-public (distribute-funds (victim principal))
  (let ((claim (unwrap! (contract-call? .claim-processing get-claim victim) (err u108))))
    (asserts! (get approved claim) (err u109))
    (try! (as-contract (stx-transfer? (get amount claim) tx-sender victim)))
    ;; Mark as distributed (could add a map for tracking)
    (ok (get amount claim))
  )
)
```

### 6. Governance.clar
A simple DAO for managing parameters, like opening/closing claim windows or selecting oracles.

```clarity
;; Governance Contract
(define-constant admin tx-sender)
(define-map proposals uint { description: (string-ascii 256), votes-for: u128, votes-against: u128, executed: bool })
(define-data-var proposal-count uint 0)
(define-map voters { proposal: uint, voter: principal } bool)

(define-public (create-proposal (description (string-ascii 256)))
  (begin
    (var-set proposal-count (+ (var-get proposal-count) u1))
    (map-set proposals (var-get proposal-count) { description: description, votes-for: u0, votes-against: u0, executed: false })
    (ok (var-get proposal-count))
  )
)

(define-public (vote (proposal-id uint) (in-favor bool))
  (let ((proposal (unwrap! (map-get? proposals proposal-id) (err u110))))
    (asserts! (not (default-to false (map-get? voters { proposal: proposal-id, voter: tx-sender }))) (err u111)) ;; No double voting
    (if in-favor
      (map-set proposals proposal-id { description: (get description proposal), votes-for: (+ (get votes-for proposal) u1), votes-against: (get votes-against proposal), executed: (get executed proposal) })
      (map-set proposals proposal-id { description: (get description proposal), votes-for: (get votes-for proposal), votes-against: (+ (get votes-against proposal) u1), executed: (get executed proposal) })
    )
    (map-set voters { proposal: proposal-id, voter: tx-sender } true)
    (ok true)
  )
)

(define-public (execute-proposal (proposal-id uint))
  (let ((proposal (unwrap! (map-get? proposals proposal-id) (err u112))))
    (asserts! (is-eq tx-sender admin) (err u113))
    (asserts! (> (get votes-for proposal) (get votes-against proposal)) (err u114))
    ;; Execute logic here, e.g., set variables in other contracts
    (map-set proposals proposal-id { description: (get description proposal), votes-for: (get votes-for proposal), votes-against: (get votes-against proposal), executed: true })
    (ok true)
  )
)

(define-read-only (get-admin)
  (ok admin)
)
```

## Deployment and Usage

1. **Deploy Contracts**: Use the Stacks CLI to deploy each .clar file in order (e.g., `stacks deploy DonationPool.clar`).
2. **Inter-Contract Calls**: Update placeholders (e.g., contract principals) after deployment.
3. **Testing**: Use the Stacks testnet. Write tests in Clarity for each function.
4. **Integration**: Build a frontend (e.g., with React and @stacks/connect) for user interaction.
5. **Security**: Audit contracts; Clarity's design prevents reentrancy, but review for logic errors.

## Future Enhancements
- Integrate real oracles (e.g., Chainlink on Stacks).
- Add multi-sig for governance.
- Support NFTs for donor recognition.

This project is open-source under MIT License. Contributions welcome!