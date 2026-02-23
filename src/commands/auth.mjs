export async function commandLogin(flags, deps) {
  const { withClient, readPasswordFromStdin, writeOutput } = deps;
  const client = await withClient(flags);
  const password =
    flags["password-stdin"]
      ? await readPasswordFromStdin()
      : flags.password ?? process.env.TR_PASSWORD ?? null;
  const result = await client.login({
    username: flags.username ?? process.env.TR_USERNAME ?? null,
    password,
    returnPath: flags["return-path"] ?? "/app/career/quinnsprouse",
  });
  await writeOutput(result, { ...flags, json: true });
}

export async function commandWhoAmI(flags, deps) {
  const { withClient, writeOutput } = deps;
  const client = await withClient(flags);
  const info = await client.getMemberInfo();
  await writeOutput(info, { ...flags, json: true });
}

export async function commandLogout(flags, deps) {
  const { withClient, writeOutput } = deps;
  const client = await withClient(flags);
  await client.clearSession();
  await writeOutput({ ok: true, message: "Session cleared." }, { ...flags, json: true });
}
