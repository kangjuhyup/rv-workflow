# Test-Driven Development

For an implementation or bug fix, write one behavior-focused test before production code. Run it and confirm it fails because the requested capability is absent, not because of a typo or broken fixture. A test that passes immediately does not establish the new contract.

Write only enough production code to make the failing test pass. Re-run the focused test, then the affected suite. Refactor only while green. Tests should express observable policy, use real code where practical, and avoid assertions tied to implementation details. Do not rewrite an accepted test merely to accommodate the implementation; report a genuine contract mismatch first. Repeat the red-green-refactor cycle for each distinct behavior.
