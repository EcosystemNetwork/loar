export function sql(strings: TemplateStringsArray, ...values: unknown[]) {
  return { strings: [...strings], values };
}
