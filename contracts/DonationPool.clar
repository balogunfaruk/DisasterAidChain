;; DonationPool Contract
;; This contract manages donations for disaster aid, supporting multiple campaigns.
;; It tracks total funds per campaign, donor contributions, and allows for transparent management.
;; Features include: creating campaigns, donating to specific campaigns, refund mechanisms under conditions,
;; governance integration for withdrawals, event logging via prints, and various query functions.
;; Designed to be robust, with error handling and access controls.

;; Constants
(define-constant ERR-UNAUTHORIZED u100)
(define-constant ERR-INVALID-AMOUNT u101)
(define-constant ERR-CAMPAIGN-NOT-FOUND u102)
(define-constant ERR-CAMPAIGN-EXISTS u103)
(define-constant ERR-REFUND-NOT-ALLOWED u104)
(define-constant ERR-INSUFFICIENT-FUNDS u105)
(define-constant ERR-PAUSED u106)
(define-constant ERR-INVALID-CAMPAIGN-NAME u107)
(define-constant MAX-CAMPAIGN-NAME-LEN u50)
(define-constant CONTRACT-OWNER tx-sender)

;; Data Variables
(define-data-var paused bool false)
(define-data-var admin principal tx-sender)
(define-data-var campaign-counter uint u0)

;; Data Maps
(define-map campaigns uint 
  {
    name: (string-ascii 50),
    description: (string-utf8 200),
    total-funds: uint,
    active: bool,
    created-at: uint,
    creator: principal
  }
)

(define-map donor-contributions 
  { donor: principal, campaign-id: uint } 
  { amount: uint }
)

(define-map refunds 
  { donor: principal, campaign-id: uint } 
  { amount: uint, requested: bool, approved: bool }
)

;; Private Functions
(define-private (is-admin (caller principal))
  (is-eq caller (var-get admin))
)

(define-private (campaign-exists (campaign-id uint))
  (is-some (map-get? campaigns campaign-id))
)

(define-private (get-campaign-funds (campaign-id uint))
  (default-to u0 (get total-funds (map-get? campaigns campaign-id)))
)

(define-private (update-campaign-funds (campaign-id uint) (new-amount uint))
  (match (map-get? campaigns campaign-id)
    campaign
    (map-set campaigns campaign-id 
      (merge campaign { total-funds: new-amount }))
    false
  )
)

(define-private (emit-event (event-type (string-ascii 20)) (details (tuple (key (string-ascii 20)) (value uint))))
  (print { event: event-type, details: details })
)

;; Public Functions

(define-public (create-campaign (name (string-ascii 50)) (description (string-utf8 200)))
  (let 
    (
      (campaign-id (+ (var-get campaign-counter) u1))
    )
    (asserts! (not (var-get paused)) (err ERR-PAUSED))
    (asserts! (<= (len name) MAX-CAMPAIGN-NAME-LEN) (err ERR-INVALID-CAMPAIGN-NAME))
    (asserts! (not (campaign-exists campaign-id)) (err ERR-CAMPAIGN-EXISTS)) ;; Though ID is incremental, for safety
    (map-set campaigns campaign-id
      {
        name: name,
        description: description,
        total-funds: u0,
        active: true,
        created-at: block-height,
        creator: tx-sender
      }
    )
    (var-set campaign-counter campaign-id)
    (emit-event "campaign-created" { key: "id", value: campaign-id })
    (ok campaign-id)
  )
)

(define-public (donate (campaign-id uint) (amount uint))
  (begin
    (asserts! (not (var-get paused)) (err ERR-PAUSED))
    (asserts! (> amount u0) (err ERR-INVALID-AMOUNT))
    (asserts! (campaign-exists campaign-id) (err ERR-CAMPAIGN-NOT-FOUND))
    (try! (stx-transfer? amount tx-sender (as-contract tx-sender)))
    (let 
      (
        (current-funds (get-campaign-funds campaign-id))
        (new-funds (+ current-funds amount))
        (current-contribution (default-to u0 (get amount (map-get? donor-contributions { donor: tx-sender, campaign-id: campaign-id }))))
        (new-contribution (+ current-contribution amount))
      )
      (update-campaign-funds campaign-id new-funds)
      (map-set donor-contributions { donor: tx-sender, campaign-id: campaign-id } { amount: new-contribution })
      (emit-event "donation-received" { key: "amount", value: amount })
      (ok amount)
    )
  )
)

(define-public (request-refund (campaign-id uint) (amount uint))
  (begin
    (asserts! (not (var-get paused)) (err ERR-PAUSED))
    (asserts! (> amount u0) (err ERR-INVALID-AMOUNT))
    (asserts! (campaign-exists campaign-id) (err ERR-CAMPAIGN-NOT-FOUND))
    (let 
      (
        (contribution (default-to u0 (get amount (map-get? donor-contributions { donor: tx-sender, campaign-id: campaign-id }))))
      )
      (asserts! (>= contribution amount) (err ERR-INSUFFICIENT-FUNDS))
      ;; Example condition: refund only if campaign not active, in real: integrate with governance/oracle
      (asserts! (not (default-to false (get active (map-get? campaigns campaign-id)))) (err ERR-REFUND-NOT-ALLOWED))
      (map-set refunds { donor: tx-sender, campaign-id: campaign-id } { amount: amount, requested: true, approved: false })
      (emit-event "refund-requested" { key: "amount", value: amount })
      (ok true)
    )
  )
)

(define-public (approve-refund (donor principal) (campaign-id uint))
  (let 
    (
      (refund (map-get? refunds { donor: donor, campaign-id: campaign-id }))
    )
    (asserts! (is-admin tx-sender) (err ERR-UNAUTHORIZED))
    (asserts! (is-some refund) (err ERR-CAMPAIGN-NOT-FOUND))
    (asserts! (get requested (unwrap-panic refund)) (err ERR-REFUND-NOT-ALLOWED))
    (let 
      (
        (amount (get amount (unwrap-panic refund)))
        (current-funds (get-campaign-funds campaign-id))
      )
      (asserts! (>= current-funds amount) (err ERR-INSUFFICIENT-FUNDS))
      (try! (as-contract (stx-transfer? amount tx-sender donor)))
      (update-campaign-funds campaign-id (- current-funds amount))
      (map-set refunds { donor: donor, campaign-id: campaign-id } (merge (unwrap-panic refund) { approved: true }))
      (emit-event "refund-approved" { key: "amount", value: amount })
      (ok true)
    )
  )
)

(define-public (withdraw-funds (campaign-id uint) (amount uint) (recipient principal))
  (begin
    (asserts! (is-admin tx-sender) (err ERR-UNAUTHORIZED))
    (asserts! (not (var-get paused)) (err ERR-PAUSED))
    (asserts! (> amount u0) (err ERR-INVALID-AMOUNT))
    (asserts! (campaign-exists campaign-id) (err ERR-CAMPAIGN-NOT-FOUND))
    (let 
      (
        (current-funds (get-campaign-funds campaign-id))
      )
      (asserts! (>= current-funds amount) (err ERR-INSUFFICIENT-FUNDS))
      (try! (as-contract (stx-transfer? amount tx-sender recipient)))
      (update-campaign-funds campaign-id (- current-funds amount))
      (emit-event "funds-withdrawn" { key: "amount", value: amount })
      (ok amount)
    )
  )
)

(define-public (set-admin (new-admin principal))
  (begin
    (asserts! (is-admin tx-sender) (err ERR-UNAUTHORIZED))
    (var-set admin new-admin)
    (ok true)
  )
)

(define-public (pause)
  (begin
    (asserts! (is-admin tx-sender) (err ERR-UNAUTHORIZED))
    (var-set paused true)
    (ok true)
  )
)

(define-public (unpause)
  (begin
    (asserts! (is-admin tx-sender) (err ERR-UNAUTHORIZED))
    (var-set paused false)
    (ok true)
  )
)

(define-public (deactivate-campaign (campaign-id uint))
  (begin
    (asserts! (is-admin tx-sender) (err ERR-UNAUTHORIZED))
    (asserts! (campaign-exists campaign-id) (err ERR-CAMPAIGN-NOT-FOUND))
    (match (map-get? campaigns campaign-id)
      campaign
      (begin
        (map-set campaigns campaign-id (merge campaign { active: false }))
        (ok true)
      )
      (err ERR-CAMPAIGN-NOT-FOUND)
    )
  )
)

;; Read-Only Functions

(define-read-only (get-total-funds (campaign-id uint))
  (ok (get-campaign-funds campaign-id))
)

(define-read-only (get-donor-contribution (donor principal) (campaign-id uint))
  (ok (default-to u0 (get amount (map-get? donor-contributions { donor: donor, campaign-id: campaign-id }))))
)

(define-read-only (get-campaign-details (campaign-id uint))
  (map-get? campaigns campaign-id)
)

(define-read-only (get-refund-status (donor principal) (campaign-id uint))
  (map-get? refunds { donor: donor, campaign-id: campaign-id })
)

(define-read-only (is-paused)
  (ok (var-get paused))
)

(define-read-only (get-admin)
  (ok (var-get admin))
)

(define-read-only (get-campaign-count)
  (ok (var-get campaign-counter))
)

;; Additional robust functions can be added here if needed to extend functionality.
;; For example, batch donations or multi-campaign queries, but keeping to core for now.