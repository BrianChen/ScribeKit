/** @type {import("eslint").Rule.RuleModule} */
export default {
  meta: {
    type: "suggestion",
    docs: {
      description: "Disallow separate `export { X }` when the declaration can be exported inline",
    },
    messages: {
      noSeparateExport:
        "Use inline `export` at the declaration site instead of a separate `export { {{name}} }`.",
    },
    schema: [],
  },
  create(context) {
    return {
      ExportNamedDeclaration(node) {
        if (node.declaration) return;
        if (node.source) return;

        for (const specifier of node.specifiers) {
          context.report({
            node,
            messageId: "noSeparateExport",
            data: { name: specifier.local.name },
          });
        }
      },
    };
  },
};
