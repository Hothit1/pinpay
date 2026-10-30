# Decisions

- 2026-10-30: one repo per project (each repo submitted once; README names sister project).
- 2026-10-30: tracked docs use neutral machine labels (mac-mini/macbook) and a pseudonymous git identity; no personal info or other brands in this repo. All demo metrics are synthetic.
- 2026-10-30: pin near-sdk ~5.17 with rustc 1.86 (MSRV resolver). near-sdk 5.30 wasm imports gas-key/global-contract host fns that sandbox 2.13 rejects.
