# Systematic Debugging

Do not propose a fix until the failure is reproduced or bounded with evidence. Capture the exact symptom, environment, inputs, and first actionable error. Trace the data and control flow from the failure back to its source, including sibling callers and boundary transformations. Distinguish product defects from fixtures, infrastructure, version mismatches, and stale generated output.

Form one falsifiable hypothesis at a time and run the smallest experiment that can disprove it. Change one variable per experiment. Once the root cause is established, add the narrowest regression check that fails for the original reason, implement the smallest root-cause fix, then expand verification according to blast radius. Avoid symptom patches, arbitrary retries, and bundles of untested changes.
