export const env: CloudflareBindings = {
  SERVER: {
    fetch() {
      throw new Error("SERVER.fetch must be mocked by tests that exercise SSR transport");
    },
  } as unknown as CloudflareBindings["SERVER"],
};
