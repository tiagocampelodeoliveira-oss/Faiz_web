// Relatório do teste: números de uso e respostas da pesquisa de cada testador.
// NÃO lê conversas, nomes de tarefas nem valores de dinheiro: só contadores, aparelho e a pesquisa.
// Roda no GitHub Actions (workflow "Relatório do teste", botão Run workflow) e escreve o resultado em anotações.
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN!;
const REF = process.env.SUPABASE_PROJECT_REF!;
const keys: { name: string; type?: string; api_key: string }[] = await (await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json();
const service = keys.find((k) => k.name === 'service_role' || k.type === 'secret')!.api_key;
console.log(`::add-mask::${service}`);
const H = service.startsWith('sb_') ? { apikey: service } : { apikey: service, Authorization: `Bearer ${service}` };
const get = async (path: string) => (await fetch(`https://${REF}.supabase.co/rest/v1/${path}`, { headers: H })).json();

const states: { user_id: string; data: any; updated_at: string }[] = await get('states?select=user_id,data,updated_at');
const owners = new Set(((await get('owners?select=user_id')) as any[]).map((o) => o.user_id));
const subs = new Set(((await get('subs?select=user_id')) as any[]).map((s) => s.user_id));
const reports: any[] = await get('reports?select=user_id,text,ctx,created_at&order=created_at.asc');

const pct = (n: number, d: number) => (d ? Math.round((100 * n) / d) : 0);
const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);

const pessoas = states
  .filter((s) => s.data?.onboarded)
  .map((s) => {
    const d = s.data, st = d.stats || {};
    return {
      nome: String(d.name || '').trim().split(/\s+/)[0] || '(sem nome)',
      dono: owners.has(s.user_id),
      inicio: d.startDate || [...(st.days || [])].sort()[0] || null,
      ultimoUso: s.updated_at.slice(0, 10),
      aparelho: st.device || '?',
      avisosLigados: subs.has(s.user_id),
      testeDeAviso: st.pushTest || 'não fez',
      diasUsados: (st.days || []).length,
      dias: st.days || [],
      pedidos: st.requests || 0,
      iaFalhas: st.aiFail || 0,
      planosConfirmados: st.confirmed || 0,
      ajustados: st.adjusted || 0,
      desfeitos: st.undone || 0,
      tarefasConcluidas: st.tasksDone || 0,
      avisosAbertos: st.opened || 0,
      adiados: st.snoozed || 0,
      voz: st.voice || 0,
      lugares: st.nearby || 0,
      tarefasNaAgenda: (d.tasks || []).length,
      // contas e rotinas: só quantidades (nunca valores nem nomes)
      rotinas: (d.routines || []).length,
      contasFixas: (d.fin?.fixas || []).length,
      anotacoesDeGasto: (d.fin?.mov || []).length,
      usouLimite: !!d.fin?.limite,
      pesquisa3: d.survey?.d3 || null,
      pesquisa7: d.survey?.d7 || null,
    };
  });

const testadores = pessoas.filter((p) => !p.dono);
const base = testadores.length ? testadores : pessoas;
// Retenção: voltou no dia seguinte ao início? usou 3+ dias diferentes?
const voltouD1 = base.filter((p) => p.inicio && p.dias.some((x: string) => x > p.inicio)).length;
const tresDias = base.filter((p) => p.diasUsados >= 3).length;
const r7 = base.map((p) => p.pesquisa7).filter(Boolean) as any[];
const r3 = base.map((p) => p.pesquisa3).filter(Boolean) as any[];
const nps = r7.map((r) => Number(r.nps)).filter((n) => Number.isFinite(n));
const npsScore = nps.length ? pct(nps.filter((n) => n >= 9).length, nps.length) - pct(nps.filter((n) => n <= 6).length, nps.length) : null;
const contar = (rs: any[], k: string) => rs.reduce((acc: Record<string, number>, r) => { const v = r?.[k]; if (v != null && v !== '') acc[v] = (acc[v] || 0) + 1; return acc; }, {});

const resumo = {
  geradoEm: new Date().toISOString(),
  testadores: testadores.length,
  donoIncluido: pessoas.length - testadores.length,
  uso: {
    pedidosTotal: base.reduce((a, p) => a + p.pedidos, 0),
    planosConfirmados: base.reduce((a, p) => a + p.planosConfirmados, 0),
    tarefasConcluidas: base.reduce((a, p) => a + p.tarefasConcluidas, 0),
    avisosAbertos: base.reduce((a, p) => a + p.avisosAbertos, 0),
    comAvisosLigados: `${base.filter((p) => p.avisosLigados).length} de ${base.length}`,
    voltaramNoDiaSeguinte: `${voltouD1} de ${base.length}`,
    usaram3DiasOuMais: `${tresDias} de ${base.length}`,
    iaFalhas: base.reduce((a, p) => a + p.iaFalhas, 0),
    usaramContas: `${base.filter((p) => p.contasFixas + p.anotacoesDeGasto > 0).length} de ${base.length}`,
    usaramRotinas: `${base.filter((p) => p.rotinas > 0).length} de ${base.length}`,
  },
  pesquisaDia3: {
    respostas: r3.length,
    facilidadeMedia1a5: avg(r3.map((r) => Number(r.facil)).filter(Number.isFinite)),
    irisEntendeu: contar(r3, 'entendeu'),
    avisosAjudaram: contar(r3, 'avisos'),
    oQueIrritouOuFaltou: r3.map((r) => r.irritou).filter(Boolean),
  },
  pesquisaDia7: {
    respostas: r7.length,
    seanEllis_seNaoPudesseMaisUsar: contar(r7, 'ellis'),
    pmfMuitoDecepcionado: r7.length ? `${pct(r7.filter((r) => r.ellis === 'Muito decepcionado').length, r7.length)}% (meta: 40% ou mais)` : null,
    nps: npsScore,
    notasNps: nps,
    jeitoDaIris: contar(r7, 'iris'),
    pagariaPorMes: contar(r7, 'preco'),
    maisQueria: contar(r7, 'queria'),
    principalBeneficio: r7.map((r) => r.beneficio).filter(Boolean),
    comoMelhorar: r7.map((r) => r.melhorar).filter(Boolean),
  },
  problemasRelatados: reports.map((r) => ({ quando: r.created_at.slice(0, 16), texto: r.text, aparelho: r.ctx?.aparelho, erro: r.ctx?.ultimoErro })),
  porPessoa: pessoas.map(({ dias, ...p }) => p),
};

// O GitHub mostra até 10 anotações por etapa e corta textos muito longos: divide em partes.
const txt = JSON.stringify(resumo);
const partes = Math.ceil(txt.length / 30000);
for (let i = 0; i < partes; i++) console.log(`::warning::RELATÓRIO ${i + 1}/${partes}: ${txt.slice(i * 30000, (i + 1) * 30000)}`);
console.log(JSON.stringify(resumo, null, 2));
