# Candidate-only model pipeline: review scope

This change is a review-only proposal. It does not merge, retrain, dispatch a workflow, promote a model, or deploy the application. The existing serving model, previous model, production manifest, prediction functions, and training mathematics remain unchanged.

## What changes after an explicitly approved merge

- The four scheduled research workflows (`train-model`, `automl`, `auto-improve`, and `multibet-strategy`) write to fresh `candidate-output/<kind>/` directories and archive their results as GitHub Actions artifacts. They no longer commit or push research results to `main`.
- Their workflow tokens use `contents: read`, and checkout does not persist credentials. This changes no project-level access setting or secret.
- Weekly AutoML still computes its comparison, but `auto_cycle.py` defaults to candidate-only. Its scheduled caller passes `--candidate-only` explicitly. An existing manual promotion path requires an explicit `--promote` opt-in and separate release authorization. No scheduled workflow invokes it.
- Candidate registry history is included in each run's artifact, seeded from the existing repository history. The repository registry is no longer a continuously updated research log. New run history is the collection of immutable artifacts, not a replacement for serving state.
- The browser title displays the version of the model it actually loaded. A separate label reports missing or mismatched manifest metadata. A manifest response cannot replace the model or change predictions; stale asynchronous responses are ignored.

## Existing inconsistency is disclosed, not silently repaired

At reviewed base `aaddf14d8cdec476920fbd633655ea84e6710f5f`, `model/model.json` is the v9.1 model trained on 2026-10-06, while `production-manifest.json` still names the v12 model promoted on 2026-10-04. This PR preserves both files byte-for-byte and makes the discrepancy visible.

The manifest is not proof that v12 is the model currently loaded by a browser. Displaying a matching version is an identity check only, not a model-integrity or performance certification. `model.previous.json` is an older v9.1 model, not a v12 recovery file. Choosing a serving model, rewriting release provenance, restoring v12, or reconciling the manifest requires a separate decision.

## Artifact contract and retention

- Completed research: `<kind>-candidate-<run_id>-<run_attempt>`, requested retention **14 days**.
- Failed/incomplete research: `<kind>-INCOMPLETE-<run_id>-<run_attempt>`, requested retention **7 days**. These artifacts are diagnostic only.
- Actual expiry is GitHub's returned `expires_at`, bounded by repository/organization policy. No permanent archive is promised.
- Uploads use a pinned `actions/upload-artifact` v4.6.2 commit, unique names, and `overwrite: false`. Upload failure is a failed run, not successful preservation.
- `baseline.json` binds the source commit, run ID, attempt, and hashes of the serving/research files that existed before computation.
- `bundle-manifest.json` exists only after the existing research validators and the additional safety guard have succeeded. It records an exact file list, sizes and SHA256 hashes, source/run identity, and `publicationAllowed: false`.
- The temporary evaluation model is retained with the daily results, so evaluation and production-candidate provenance can be reviewed together.
- A completed artifact is review material. It is not an instruction or authorization to publish.

## Unknown means stop

Missing outputs, an unknown schema or feature ordering, invalid/non-finite model values, duplicate JSON keys, nonpositive scales, symlinked outputs, serving-file changes, run-identity changes, unexpected files, or digest mismatches stop the guard. It does not retrain, repair metadata, select a fallback model, or retry publication. A pre-existing known manifest-version discrepancy is recorded without changing either file; it does not authorize any release.

An artifact without a verified completed manifest is incomplete. The `verify` command checks file integrity only. Any future publisher must separately verify the exact GitHub artifact/run/source, expiration, evaluation evidence, approved target model hash, current serving release, compatibility, and explicit authorization. This PR adds no publisher.

## Push-only retry is deliberately not implemented

Research no longer pushes, so a transient repository push error cannot discard results after a successful artifact upload. A later approved release publisher could retry sending the same frozen commit after checking the remote state. It must stop on ambiguity, a changed base, a permissions error, or non-fast-forward; it must not force-push, rebase automatically, or retrain.

The October 7 failed run has no stored artifact. These changes cannot reconstruct its lost output or turn rerunning its entire training job into a push-only retry.

## Review branch and execution boundaries

`vercel.json` disables Git deployments only for `dot/review-model-pipeline-20261008`. The first branch reference must point directly to a commit already containing that rule. Other branches, including `main`, retain their existing deployment behavior. No Vercel dashboard, protection, credential, or permission setting is changed.

None of the repository's eight workflow trigger headers contains a push or pull-request trigger. Existing scheduled workflows run from the default branch, and no workflow is dispatched for this review. The draft PR itself is not approval to merge or deploy. After publication, inspect GitHub checks for this exact branch/commit. The current Vercel connection returned HTTP 403 for deployment-list access, so absence of preview deployments cannot be directly observed from that list. The branch-specific suppression is independently checked against the official configuration specification; no permission expansion or bypass is part of this change.

## Offline verification

Run from the repository root with Python 3.12+, Node 22+, and the test-only PyYAML package available:

```sh
python3 -m unittest discover -s tests -p 'test_*.py' -v
node --test tests/model_identity.test.cjs
python3 -m py_compile training/candidate_artifacts.py training/auto_cycle.py
```

The tests use synthetic artifacts and orchestration stubs. They do not acquire races, run training, invoke GitHub Actions, or publish anything. The preserved-source and UI-function digests bind the unchanged prediction/training code and serving model to the reviewed base.

The changed four workflows parse successfully. A separate pre-existing manual workflow, `fix-trifecta-key.yml`, has invalid YAML indentation inside its embedded script. It is unchanged and outside this PR's scope. Full historical workflow execution, a fresh model-quality evaluation, and live browser/network validation are not claimed.
