
# TRUCKING DISPATCH PLATFORM — CLAUDE CODE CONTEXT
## What This Platform Is
A trucking dispatch ecosystem where Agencies post loads and Fleets execute them.
## Platform Hierarchy
Platform
├── Super Admin
├── Agencies
│     ├── Agency Admin
│     ├── Dispatchers
│     └── Loads
└── Fleets
      ├── Fleet Admin
      ├── Drivers
      └── Vehicles
## Tech Stack
- Backend: Node.js + Express + Prisma + PostgreSQL + Redis
- Frontend: Next.js + Tailwind CSS + shadcn/ui
- Mobile: React Native + Expo (Driver app only)
- Auth: JWT + Redis (single session enforcement)
- Storage: AWS S3 or Cloudflare R2
- Email: Resend or SendGrid
- PDF: Puppeteer or React PDF
## Core Business Rules
### Loads
- Only Dispatchers create loads
- Dispatcher selects Fleet → Driver dropdown filters to that fleet only → Vehicle dropdown filters to that fleet only
- Status flow: Draft → Assigned → In Transit → Pending Delivery Confirmation → Delivered → Completed
- Cancellation only allowed before In Transit
- Driver marks delivered via mobile app and uploads POD
- Dispatcher who created the load must accept or reject delivery confirmation
- Completed status is AUTOMATIC immediately after dispatcher accepts delivery
- Invoice AUTO-GENERATED on Completed status
- Invoice due date = load completion date + agency.paymentTermsDays
### Dispatchers
- One active agency at a time
- Transfer requires BOTH current and new agency admin approval
- Dispatcher SUSPENDED immediately when transfer is requested
- Transfer blocked if dispatcher has Draft, Assigned, or In Transit loads
- If dispatcher cancels transfer → Suspended (Restoration Pending) → requires agency admin to restore
- If restoration declined → Inactive → can send Join Request to another agency
- Join requests have 30-day cooldown per agency after decline
### Drivers
- One active fleet at a time
- Transfer requires BOTH current and new fleet admin approval
- Same suspension and blocking logic as dispatchers
- Driver approved by Fleet Admin only (not Super Admin)
- Driver cannot reject loads
### Fleets
- Completely independent — not owned by any agency
- Can work with multiple agencies simultaneously (different commission per relationship)
- Invited by Agency Admin → Fleet registers → Super Admin approves ONCE
- Multiple agency invites = still only one Super Admin approval needed
### Invoices and Receipts
- Invoice generated automatically when load is Completed
- Due date = completion date + agency.paymentTermsDays
- Payment happens OUTSIDE platform — Agency Admin records manually
- Receipt auto-generated when Agency Admin records payment
- Invoice and Receipt carry Agency branding (logo, colors, footer)
- Transfer-related emails use Platform branding only
### Sessions
- ONE active session per user at all times
- New login invalidates all previous sessions immediately
- Web timeout: 30 minutes inactivity
- Mobile timeout: 60 minutes EXCEPT if driver has In Transit load
- Forced logout on suspension — immediate
## Security Rules
### Agency Data Isolation
- EVERY query on agency-owned data MUST filter by agency_id
- Enforce at database level with Row Level Security
- Fleet sees only loads assigned to them
### Role-Based Financial Visibility
Field               | SuperAdmin | AgencyAdmin | Dispatcher | FleetAdmin | Driver
loadRate            | YES        | YES         | YES        | YES        | NO
commissionPercent   | YES        | YES         | NO         | YES        | NO
commissionAmount    | YES        | YES         | NO         | YES        | NO
dispatcherEarnings  | YES        | YES         | YES        | NO         | NO
fleetEarnings       | YES        | YES         | NO         | YES        | NO
platformRevenue     | YES        | NO          | NO         | NO         | NO
Enforce at API level — strip fields before sending response, not just on UI.
### Audit Logging
- Every mutation writes to audit_logs table
- Log: actorId, actorRole, actionType, entityType, entityId, oldValue JSON, newValue JSON, timestamp, ipAddress
- Audit logs are IMMUTABLE — no update or delete endpoints ever
### Single Session
- On login: invalidate all existing active sessions for that userId first, then create new
- On suspension: invalidate all active sessions immediately
- Check session validity on every authenticated request via Redis
## Middleware Stack Order
1. authenticate — validate JWT + check Redis session is active
2. requireRole — check role matches route
3. enforceAgencyIsolation — inject req.isolation
4. enforceFinancialVisibility — strip financial fields from response
5. auditLog — log mutation after successful response
6. route handler
## Key Status Enums
LoadStatus:
DRAFT → ASSIGNED → IN_TRANSIT → PENDING_DELIVERY_CONFIRMATION → DELIVERED → COMPLETED
CANCELLED only allowed before IN_TRANSIT
DispatcherStatus:
PENDING | ACTIVE | SUSPENDED_TRANSFER | SUSPENDED_RESTORATION | INACTIVE
DriverStatus:
PENDING | ACTIVE | ON_LOAD | SUSPENDED_TRANSFER | SUSPENDED_RESTORATION | INACTIVE
FleetStatus:
INVITED | PENDING | ACTIVE | REJECTED | SUSPENDED | INACTIVE
InvoiceStatus:
UNPAID | PARTIALLY_PAID | PAID | OVERDUE | DISPUTED
## Module Build Order
1. Database schema + migrations
2. Auth + sessions + middleware
3. Agency module
4. Fleet registration + approval
5. Dispatcher module with full transfer flow
6. Driver module with full transfer flow
7. Vehicle module
8. Load module with full lifecycle
9. Invoice + Receipt + PDF generation
10. Email service with branded templates
11. Notification system
12. Super Admin dashboard APIs
13. Driver mobile app APIs
14. Frontend web dashboards
15. Driver mobile app in React Native
## Rules — Never Break These
- Never build frontend and backend at the same time
- Never expose financial fields to unauthorized roles — enforce at API not just UI
- Never let agency data leak across agencies
- Never allow audit logs to be deleted or edited
- Never allow more than one active session per user
- Never auto-complete a load without dispatcher accepting delivery
- Never allow a driver to be assigned to a load from a different fleet
- Never allow a vehicle under maintenance to be assigned to a load
- Never allow a transfer request if dispatcher or driver has active loads
