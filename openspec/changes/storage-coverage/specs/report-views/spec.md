## ADDED Requirements

### Requirement: Storage panel
Every shareable trace view SHALL include in its evidence section a storage block listing, per drive with a recorded series, its label and class, its latency, queue, busy percentage and throughput at the hangs versus calm, its pagefile and workload placement, and its volumes' free space, and SHALL chart one series per drive beside the machine total. A value that is not recorded SHALL appear as "not available" with its reason, never blank.

#### Scenario: Multi-drive report rendered
- **GIVEN** a fixture with two drives, one slow at the hangs and hosting the pagefile
- **WHEN** it is rendered to Markdown and HTML
- **THEN** both outputs list both drives by label with hang and calm latency, and state that the slow drive hosts the pagefile
- **AND** the disk chart has a series per drive

#### Scenario: Missing per-drive data uses a placeholder
- **GIVEN** a fixture with only the machine total
- **WHEN** it is rendered
- **THEN** the storage block reads "Per-drive disk data: not available (<reason>)" and the machine-total charts are unchanged

#### Scenario: Out-of-scope culprit stays anonymous in the view
- **GIVEN** a fixture whose disk stall is driven by the out-of-scope aggregate
- **WHEN** it is rendered
- **THEN** the view states that the I/O was dominated by load outside the declared scope and shows no process name for it
