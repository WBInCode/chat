import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { toCsv } from "./documents/service.js";

// F8: shared per-channel documents (blocks, locks, revisions, comments).

let app: FastifyInstance;
const uniq = Date.now().toString(36);
const PASSWORD = "BardzoBezpieczneHaslo123";

interface Session {
  token: string;
  userId: string;
}

async function registerAndLogin(email: string, displayName: string): Promise<Session> {
  await app.inject({
    method: "POST",
    url: "/api/v1/auth/register",
    payload: { email, password: PASSWORD, displayName }
  });
  const login = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { email, password: PASSWORD }
  });
  const body = login.json();
  return { token: body.accessToken, userId: body.user.id };
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

let owner: Session;
let member: Session;
let outsider: Session;
let orgId: string;
let channelId: string;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  app = await buildApp();
  await app.ready();

  owner = await registerAndLogin(`doc-owner-${uniq}@example.com`, "Owner");
  member = await registerAndLogin(`doc-member-${uniq}@example.com`, "Member");
  outsider = await registerAndLogin(`doc-outsider-${uniq}@example.com`, "Outsider");

  const org = await app.inject({
    method: "POST",
    url: "/api/v1/orgs",
    headers: auth(owner.token),
    payload: { name: "Documents Test Org", slug: `doc-test-${uniq}` }
  });
  orgId = org.json().id;
  await app.prisma.membership.create({ data: { userId: member.userId, orgId, role: "MEMBER" } });

  const channel = await app.inject({
    method: "POST",
    url: `/api/v1/orgs/${orgId}/channels`,
    headers: auth(owner.token),
    payload: { type: "PUBLIC", name: `docs-${uniq}` }
  });
  channelId = channel.json().id;
  // Public channels auto-enrol org members, so membership only needs a nudge
  // if that ever stops being true.
  await app.prisma.channelMember.upsert({
    where: { channelId_userId: { channelId, userId: member.userId } },
    update: {},
    create: { channelId, userId: member.userId, role: "MEMBER" }
  });
});

afterAll(async () => {
  await app.close();
});

async function createDocument(title: string, token = owner.token) {
  const res = await app.inject({
    method: "POST",
    url: `/api/v1/channels/${channelId}/documents`,
    headers: auth(token),
    payload: { title }
  });
  return res;
}

async function addBlock(documentId: string, data: unknown, token = owner.token) {
  return app.inject({
    method: "POST",
    url: `/api/v1/documents/${documentId}/blocks`,
    headers: auth(token),
    payload: { data }
  });
}

describe("documents", () => {
  it("creates a document seeded with a heading and lists it in the channel", async () => {
    const created = await createDocument("Plan wdrożenia");
    expect(created.statusCode).toBe(201);
    const doc = created.json();
    expect(doc.title).toBe("Plan wdrożenia");
    expect(doc.blocks).toHaveLength(1);
    expect(doc.blocks[0].data).toMatchObject({ type: "heading", text: "Plan wdrożenia" });

    const list = await app.inject({
      method: "GET",
      url: `/api/v1/channels/${channelId}/documents`,
      headers: auth(member.token)
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().some((d: { id: string }) => d.id === doc.id)).toBe(true);
  });

  it("hides documents from people outside the channel", async () => {
    const doc = (await createDocument("Poufne ustalenia")).json();

    const read = await app.inject({
      method: "GET",
      url: `/api/v1/documents/${doc.id}`,
      headers: auth(outsider.token)
    });
    expect(read.statusCode).toBe(404);

    const list = await app.inject({
      method: "GET",
      url: `/api/v1/channels/${channelId}/documents`,
      headers: auth(outsider.token)
    });
    expect(list.statusCode).toBe(404);
  });

  it("rejects a table whose rows do not match the header width", async () => {
    const doc = (await createDocument("Tabela niepoprawna")).json();
    const res = await addBlock(doc.id, {
      type: "table",
      header: ["A", "B"],
      align: ["left", "left"],
      rows: [["1", "2"], ["3"]]
    });
    expect(res.statusCode).toBe(400);
  });

  it("stores a table and exports it as CSV", async () => {
    const doc = (await createDocument("Cennik")).json();
    const block = await addBlock(doc.id, {
      type: "table",
      header: ["Usługa", "Cena"],
      align: ["left", "right"],
      rows: [["Wdrożenie", "12 000"], ["Szkolenie", "3 500"]]
    });
    expect(block.statusCode).toBe(201);

    const csv = await app.inject({
      method: "GET",
      url: `/api/v1/documents/${doc.id}/blocks/${block.json().id}/csv`,
      headers: auth(member.token)
    });
    expect(csv.statusCode).toBe(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.body).toContain('"Usługa","Cena"');
    expect(csv.body).toContain('"Wdrożenie","12 000"');
  });

  it("refuses a second save that is based on a stale version", async () => {
    const doc = (await createDocument("Konflikt")).json();
    const block = (await addBlock(doc.id, { type: "text", text: "pierwsza wersja" })).json();

    const first = await app.inject({
      method: "PATCH",
      url: `/api/v1/documents/${doc.id}/blocks/${block.id}`,
      headers: auth(owner.token),
      payload: { version: block.version, data: { type: "text", text: "zapis A" } }
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().version).toBe(block.version + 1);

    // Second writer still holds the old version and must not clobber the first.
    const second = await app.inject({
      method: "PATCH",
      url: `/api/v1/documents/${doc.id}/blocks/${block.id}`,
      headers: auth(member.token),
      payload: { version: block.version, data: { type: "text", text: "zapis B" } }
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe("BLOCK_VERSION_CONFLICT");

    const after = await app.inject({
      method: "GET",
      url: `/api/v1/documents/${doc.id}`,
      headers: auth(owner.token)
    });
    expect(after.json().blocks.find((b: { id: string }) => b.id === block.id).data.text).toBe("zapis A");
  });

  it("blocks a second editor while someone holds the lock, and frees it on release", async () => {
    const doc = (await createDocument("Blokada")).json();
    const block = (await addBlock(doc.id, { type: "text", text: "treść" })).json();

    const mine = await app.inject({
      method: "POST",
      url: `/api/v1/documents/${doc.id}/blocks/${block.id}/lock`,
      headers: auth(owner.token)
    });
    expect(mine.statusCode).toBe(200);

    const theirs = await app.inject({
      method: "POST",
      url: `/api/v1/documents/${doc.id}/blocks/${block.id}/lock`,
      headers: auth(member.token)
    });
    expect(theirs.statusCode).toBe(409);
    expect(theirs.json().error.code).toBe("BLOCK_LOCKED");

    const blockedSave = await app.inject({
      method: "PATCH",
      url: `/api/v1/documents/${doc.id}/blocks/${block.id}`,
      headers: auth(member.token),
      payload: { version: block.version, data: { type: "text", text: "podmiana" } }
    });
    expect(blockedSave.statusCode).toBe(409);

    await app.inject({
      method: "DELETE",
      url: `/api/v1/documents/${doc.id}/blocks/${block.id}/lock`,
      headers: auth(owner.token)
    });

    const afterRelease = await app.inject({
      method: "POST",
      url: `/api/v1/documents/${doc.id}/blocks/${block.id}/lock`,
      headers: auth(member.token)
    });
    expect(afterRelease.statusCode).toBe(200);
  });

  it("lets any channel member tick a checklist item, even while the block is locked", async () => {
    const doc = (await createDocument("Zadania")).json();
    const block = (
      await addBlock(doc.id, {
        type: "checklist",
        items: [
          { id: "a", text: "Przygotować ofertę", checked: false, checkedById: null, checkedAt: null }
        ]
      })
    ).json();

    await app.inject({
      method: "POST",
      url: `/api/v1/documents/${doc.id}/blocks/${block.id}/lock`,
      headers: auth(owner.token)
    });

    const ticked = await app.inject({
      method: "POST",
      url: `/api/v1/documents/${doc.id}/blocks/${block.id}/check`,
      headers: auth(member.token),
      payload: { itemId: "a", checked: true }
    });
    expect(ticked.statusCode).toBe(200);
    expect(ticked.json().data.items[0].checked).toBe(true);
    expect(ticked.json().data.items[0].checkedById).toBe(member.userId);
    // Ticking must not consume a version, or it would break someone's open edit.
    expect(ticked.json().version).toBe(block.version);
  });

  it("records revisions and restores an earlier state without losing the current one", async () => {
    const doc = (await createDocument("Wersjonowanie")).json();
    const block = (await addBlock(doc.id, { type: "text", text: "stan pierwotny" })).json();

    // A different author forces a snapshot regardless of elapsed time.
    await app.inject({
      method: "PATCH",
      url: `/api/v1/documents/${doc.id}/blocks/${block.id}`,
      headers: auth(member.token),
      payload: { version: block.version, data: { type: "text", text: "stan zmieniony" } }
    });

    const revisions = await app.inject({
      method: "GET",
      url: `/api/v1/documents/${doc.id}/revisions`,
      headers: auth(owner.token)
    });
    expect(revisions.statusCode).toBe(200);
    expect(revisions.json().length).toBeGreaterThan(0);

    const target = revisions.json().at(-1);
    const restored = await app.inject({
      method: "POST",
      url: `/api/v1/documents/${doc.id}/revisions/${target.id}/restore`,
      headers: auth(owner.token)
    });
    expect(restored.statusCode).toBe(200);

    const afterRestore = await app.inject({
      method: "GET",
      url: `/api/v1/documents/${doc.id}/revisions`,
      headers: auth(owner.token)
    });
    expect(
      afterRestore.json().some((r: { summary: string }) => r.summary === "Stan przed przywróceniem wersji")
    ).toBe(true);
  });

  it("nie gubi odhaczenia, gdy wiele osob zaznacza rozne pozycje jednoczesnie", async () => {
    const COUNT = 12;
    const doc = (await createDocument("Wyscig na liscie")).json();
    const block = (
      await addBlock(doc.id, {
        type: "checklist",
        items: Array.from({ length: COUNT }, (_, i) => ({
          id: `i${i}`,
          text: `Pozycja ${i}`,
          checked: false,
          checkedById: null,
          checkedAt: null
        }))
      })
    ).json();

    // Kazde zadanie czyta liste, zmienia jedna pozycje i zapisuje calosc.
    // Bez blokady wiersza zapisy nadpisuja sie nawzajem i czesc odhaczen ginie.
    const results = await Promise.all(
      Array.from({ length: COUNT }, (_, i) =>
        app.inject({
          method: "POST",
          url: `/api/v1/documents/${doc.id}/blocks/${block.id}/check`,
          headers: auth(i % 2 === 0 ? owner.token : member.token),
          payload: { itemId: `i${i}`, checked: true }
        })
      )
    );
    expect(results.every((r) => r.statusCode === 200)).toBe(true);

    const after = await app.inject({
      method: "GET",
      url: `/api/v1/documents/${doc.id}`,
      headers: auth(owner.token)
    });
    const items = after.json().blocks.find((b: { id: string }) => b.id === block.id).data.items;
    const checked = items.filter((i: { checked: boolean }) => i.checked).length;
    // Wszystkie odhaczenia musza przetrwac.
    expect(checked).toBe(COUNT);
  });

  it("keeps comments when the block they point at is deleted", async () => {
    const doc = (await createDocument("Komentarze")).json();
    const block = (await addBlock(doc.id, { type: "text", text: "do omówienia" })).json();

    const comment = await app.inject({
      method: "POST",
      url: `/api/v1/documents/${doc.id}/comments`,
      headers: auth(member.token),
      payload: { blockId: block.id, body: "Czy to jest jeszcze aktualne?" }
    });
    expect(comment.statusCode).toBe(201);

    await app.inject({
      method: "DELETE",
      url: `/api/v1/documents/${doc.id}/blocks/${block.id}`,
      headers: auth(owner.token)
    });

    const comments = await app.inject({
      method: "GET",
      url: `/api/v1/documents/${doc.id}/comments`,
      headers: auth(owner.token)
    });
    const kept = comments.json().find((c: { id: string }) => c.id === comment.json().id);
    expect(kept).toBeDefined();
    expect(kept.blockId).toBeNull();
  });

  it("only lets the author or a channel admin remove a comment", async () => {
    const doc = (await createDocument("Uprawnienia komentarzy")).json();
    const comment = (
      await app.inject({
        method: "POST",
        url: `/api/v1/documents/${doc.id}/comments`,
        headers: auth(owner.token),
        payload: { body: "Uwaga autora" }
      })
    ).json();

    const byOther = await app.inject({
      method: "DELETE",
      url: `/api/v1/documents/${doc.id}/comments/${comment.id}`,
      headers: auth(member.token)
    });
    expect(byOther.statusCode).toBe(403);

    const byAuthor = await app.inject({
      method: "DELETE",
      url: `/api/v1/documents/${doc.id}/comments/${comment.id}`,
      headers: auth(owner.token)
    });
    expect(byAuthor.statusCode).toBe(204);
  });

  it("refuses everything once an admin turns the module off", async () => {
    const doc = (await createDocument("Wyłączony moduł")).json();

    await app.inject({
      method: "PATCH",
      url: `/api/v1/orgs/${orgId}/admin/modules`,
      headers: auth(owner.token),
      payload: { key: "documents", enabled: false }
    });

    try {
      const read = await app.inject({
        method: "GET",
        url: `/api/v1/documents/${doc.id}`,
        headers: auth(owner.token)
      });
      expect(read.statusCode).toBe(403);
      expect(read.json().error.code).toBe("MODULE_DISABLED");
    } finally {
      await app.inject({
        method: "PATCH",
        url: `/api/v1/orgs/${orgId}/admin/modules`,
        headers: auth(owner.token),
        payload: { key: "documents", enabled: true }
      });
    }
  });
});

describe("CSV serialisation", () => {
  it("quotes separators and doubles embedded quotes", () => {
    const csv = toCsv([
      ["Nazwa", "Opis"],
      ['Pakiet "Pro"', "Wiersz A, wiersz B"]
    ]);
    expect(csv).toBe('"Nazwa","Opis"\r\n"Pakiet ""Pro""","Wiersz A, wiersz B"');
  });

  it("neutralises cells a spreadsheet would execute as a formula", () => {
    // Without the leading apostrophe Excel runs this on open (CSV injection).
    const csv = toCsv([["=1+1", "+cmd|' /C calc'!A0", "@SUM(A1)", "-2"]]);
    expect(csv).toBe(`"'=1+1","'+cmd|' /C calc'!A0","'@SUM(A1)","'-2"`);
  });
});
