'use strict';
// One cause-class vocabulary for every output (trace JSON, pack, print, charts, trend, email).
// Pure data: requiring this module performs no I/O.

// ranked causes a rule may emit, then the non-cause outcomes of a run
const CAUSE_CLASSES = Object.freeze(['memory', 'cpu', 'disk', 'thermal-power', 'gpu', 'security-software', 'outside-scope']);
const OUTCOME_CLASSES = Object.freeze(['undetermined', 'no-freeze-observed', 'insufficient-evidence']);
const CLASSES = Object.freeze([...CAUSE_CLASSES, ...OUTCOME_CLASSES]);

// rule id -> class for the core rules. A rule module also declares its own `class`; this map is the
// published reference (diagnosis-cause-rules appends its rules here or simply declares the class in the module).
const RULE_CLASS = Object.freeze({
  'memory-pressure': 'memory',
  'cpu-saturation': 'cpu',
  'disk-stall': 'disk',
  'security-contention': 'security-software',
  'outside-scope': 'outside-scope',
  // diagnosis-cause-rules (a rule may also set a per-hang variant class; database-memory-io is memory or disk)
  'commit-limit-pressure': 'memory',
  'hard-fault-thrash': 'memory',
  'vm-memory-dominance': 'memory',
  'database-memory-io': 'memory',
  'single-process-dominance': 'memory',
  'thermal-power-throttle': 'thermal-power',
  'battery-power-plan': 'thermal-power',
  'driver-interrupt-storm': 'cpu',
  'gpu-contention': 'gpu',
});

// plain-words label per class (finding sentences, console card)
const CLASS_LABEL = Object.freeze({
  memory: 'memory pressure', cpu: 'CPU saturation', disk: 'disk stall', 'thermal-power': 'thermal or power limiting',
  gpu: 'GPU contention', 'security-software': 'security-software contention', 'outside-scope': 'load outside the declared scope',
  undetermined: 'no cause determined', 'no-freeze-observed': 'no freeze observed', 'insufficient-evidence': 'insufficient evidence',
});

// engine stages that are not ranked causes
const ENGINE_STAGES = Object.freeze(['observer-guard', 'confirmation']);

const isCauseClass = (c) => CAUSE_CLASSES.includes(c);
const isClass = (c) => CLASSES.includes(c);
const classOf = (ruleId) => RULE_CLASS[ruleId] || null;

module.exports = { CAUSE_CLASSES, OUTCOME_CLASSES, CLASSES, RULE_CLASS, CLASS_LABEL, ENGINE_STAGES, isCauseClass, isClass, classOf };
