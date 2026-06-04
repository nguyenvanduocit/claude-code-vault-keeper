/**
 * `list` primitive — validates a markdown list against list-level
 * (`min` / `max` / `unique`) and per-item (`items.required` /
 * `items.pattern` / `items.enum` / `items.task`) constraints.
 *
 * `items.task` enforces GFM task-list shape: `true` / `"any"` require every
 * item to be a checkbox (`- [ ]` or `- [x]`); `"todo"` requires unchecked,
 * `"done"` requires checked. The checkbox STATE is not visible in item text
 * (the marker is stripped during parsing) — it is read from the AST-derived
 * `item.checked` (true/false/null) that `parseList` exposes.
 *
 * Per-item issues carry their own `bodyLine` so the LSP / CLI render
 * them at the offending item's line rather than the list head.
 */

import { issue } from "../helpers/issue.js";
import { checkUnknownKeys } from "../helpers/unknown-keys.js";

/** Keys allowed at the top of `list:`. */
export const LIST_INNER_KEYS = new Set(["items", "min", "max", "unique"]);

/** Keys allowed inside `list.items:`. */
export const LIST_ITEMS_INNER_KEYS = new Set(["required", "pattern", "enum", "task"]);

function validate(_value, param, ctx) {
  const level = ctx.severity || "error";
  const field = ctx.field;

  if (!_value) {
    return [issue(level, field, ctx.message || "Expected a list but none found", "list-item")];
  }

  const issues = [];
  const items = _value.items || [];

  // List-level cardinality.
  const min = param.min ?? 0;
  const max = param.max ?? Infinity;
  if (items.length < min) {
    issues.push(issue(level, field, ctx.message || `Expected at least ${min} list item(s), found ${items.length}`, "list-item"));
  }
  if (items.length > max) {
    issues.push(issue(level, field, ctx.message || `Expected at most ${max} list item(s), found ${items.length}`, "list-item"));
  }

  // List-level uniqueness on item text.
  if (param.unique) {
    const seen = new Map();
    for (const item of items) {
      const key = item.text;
      if (seen.has(key)) {
        const dup = issue(level, field, ctx.message || `Duplicate list item '${key}'`, "unique-violation");
        dup.bodyLine = item.line;
        issues.push(dup);
      } else {
        seen.set(key, item);
      }
    }
  }

  // Per-item constraints.
  if (param.items && typeof param.items === "object") {
    const itemRules = param.items;
    let re = null;
    if (itemRules.pattern) {
      try {
        re = new RegExp(itemRules.pattern);
      } catch {
        re = null; // unparseable regex — meta-validation surfaces this
      }
    }
    const allowedEnum = Array.isArray(itemRules.enum) ? itemRules.enum.map((v) => String(v)) : null;
    const taskRule = itemRules.task; // true | "any" | "todo" | "done"
    for (const item of items) {
      if (itemRules.required && (!item.text || !item.text.trim())) {
        const i = issue(level, field, ctx.message || `List item is empty`, "list-item");
        i.bodyLine = item.line;
        issues.push(i);
        continue;
      }
      if (re && !re.test(item.text)) {
        const i = issue(level, field, ctx.message || `List item '${item.text}' does not match pattern '${itemRules.pattern}'`, "list-item");
        i.bodyLine = item.line;
        issues.push(i);
      }
      if (allowedEnum && !allowedEnum.includes(item.text)) {
        const i = issue(level, field, ctx.message || `List item '${item.text}' is not in allowed values: [${allowedEnum.join(", ")}]`, "list-item");
        i.bodyLine = item.line;
        issues.push(i);
      }
      if (taskRule) {
        if (item.checked === null || item.checked === undefined) {
          const i = issue(level, field, ctx.message || `List item '${item.text}' must be a task-list item (\`- [ ]\` or \`- [x]\`)`, "list-item");
          i.bodyLine = item.line;
          issues.push(i);
        } else if (taskRule === "done" && item.checked !== true) {
          const i = issue(level, field, ctx.message || `List item '${item.text}' must be checked (\`- [x]\`)`, "list-item");
          i.bodyLine = item.line;
          issues.push(i);
        } else if (taskRule === "todo" && item.checked !== false) {
          const i = issue(level, field, ctx.message || `List item '${item.text}' must be unchecked (\`- [ ]\`)`, "list-item");
          i.bodyLine = item.line;
          issues.push(i);
        }
      }
    }
  }

  return issues;
}

export function validateConfig(param, path, issues) {
  if (param.items && typeof param.items === "object") {
    checkUnknownKeys(param.items, LIST_ITEMS_INNER_KEYS, "'list.items'", path, issues);
    if (param.items.pattern) {
      try {
        new RegExp(param.items.pattern);
      } catch {
        issues.push(issue(
          "error",
          path,
          `Invalid regex in list.items.pattern of '${path}': ${param.items.pattern}`,
          "template-schema-invalid",
        ));
      }
    }
    if (param.items.enum !== undefined && !Array.isArray(param.items.enum)) {
      issues.push(issue(
        "error",
        path,
        `'list.items.enum' in '${path}' must be an array`,
        "template-schema-invalid",
      ));
    }
    if (param.items.task !== undefined) {
      const t = param.items.task;
      const ok = t === true || t === "any" || t === "todo" || t === "done";
      if (!ok) {
        issues.push(issue(
          "error",
          path,
          `'list.items.task' in '${path}' must be true or one of "any" | "todo" | "done"`,
          "template-schema-invalid",
        ));
      }
    }
  }
}

export const listPrimitive = {
  name: "list",
  ruleType: "object",
  innerKeys: LIST_INNER_KEYS,
  itemsInnerKeys: LIST_ITEMS_INNER_KEYS,
  select({ docNode, parseList }) {
    const listNode = docNode.contentNodes.find((n) => n.type === "list");
    return {
      value: listNode ? parseList(listNode) : null,
      anchorLine: listNode?.position?.start?.line ?? undefined,
    };
  },
  validate,
  validateConfig,
};
