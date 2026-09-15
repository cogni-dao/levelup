// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { parse } from "yaml";

const repoSpec = parse(readFileSync(".cogni/repo-spec.yaml", "utf8"));
const nodeSlug = repoSpec?.intent?.name;

if (typeof nodeSlug !== "string" || nodeSlug.length === 0) {
  throw new Error(".cogni/repo-spec.yaml must declare intent.name");
}

const root = "k8s/external-secrets";
const errors = [];

for (const environment of readdirSync(root, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()) {
  const path = join(root, environment, "external-secret.yaml");
  const manifest = parse(readFileSync(path, "utf8"));
  const expectedSecretName = `${nodeSlug}-env-secrets`;
  const checks = [
    ["metadata.name", manifest?.metadata?.name, expectedSecretName],
    [
      "metadata.labels.app.kubernetes.io/component",
      manifest?.metadata?.labels?.["app.kubernetes.io/component"],
      nodeSlug,
    ],
    ["spec.target.name", manifest?.spec?.target?.name, expectedSecretName],
    [
      "spec.dataFrom[0].extract.key",
      manifest?.spec?.dataFrom?.[0]?.extract?.key,
      `${environment}/${nodeSlug}`,
    ],
  ];

  for (const [field, actual, expected] of checks) {
    if (actual !== expected) {
      errors.push(`${path}: ${field} must be ${expected}; found ${actual}`);
    }
  }
}

if (errors.length > 0) {
  throw new Error(`ExternalSecret identity drift:\n${errors.join("\n")}`);
}

console.log(`ExternalSecret identity matches node ${nodeSlug}`);
