# dsh-doc-positivize

Um plugin do DeepSeek Harness (DSH) que mantém a documentação positiva e atual: uma guarda permanente em inglês no system prompt e o comando `/positivize`, que reescreve em documentação, comentários e textos de commit as formulações negativas ou históricas como descrições positivas.

## What it does

`apply` registra duas contribuições: uma seção global do prompt — `doc-positivize:guard`, ordem `6000` — e o comando humano `/positivize`. Com a guarda ativa, ela vale em toda requisição; o comando só quando é digitado, no próprio processo host.

## Why doc-positivize

O nome une o escopo e a ação: documentação, positivizada. A guarda aplica essa regra em cada requisição ao modelo; `/positivize` a aplica aos artefatos existentes.

A regra do projeto de referência é **a ausência é negação; o afirmativo é o padrão**.

## The guard contract

A guarda integrada está em inglês, como todas as seções do prompt, e passa na varredura de marcadores com zero ocorrências:

- **Somente o estado final**: código, comentários, títulos e descrições de commit e MR/PR, documentação e prompts descrevem o design vigente como se sempre tivesse sido assim.
- **A ausência é negação**: quando uma funcionalidade, comportamento ou plano anterior sai do design, sua descrição sai junto; resta apenas o design aceito.
- **O afirmativo é o padrão**: regras, prompts, esquemas de ferramentas e comentários declaram a única prática positiva e sua condição; ferramentas e conceitos substituídos são excluídos.

`tests/guard.test.ts` fixa esse contrato: o texto padrão passa nos padrões de marcadores com zero ocorrências, permanece em inglês e mantém as chaves literais.

## The /positivize command

```text
/positivize                  reescreve o espaço de trabalho atual como descrições positivas
/positivize README*.md       reescreve os arquivos desse escopo como descrições positivas
```

Na GUI web, o comando percorre o escopo com a lista de marcadores, pede ao modelo atual da sessão um plano mínimo de edição em JSON para cada arquivo, aplica as edições no lugar e devolve o controle imediatamente para o compositor limpar. Seu cartão de resultado traz o diff estruturado, um botão **Stop** enquanto a varredura corre e um botão **Undo** em cada arquivo alterado. A varredura fica fora do histórico do modelo, então a conversa atual mantém seu contexto intacto.

Hosts sem o serviço Connection (CLI e headless) usam o caminho em primeiro plano: o comando espera a varredura e devolve o relatório de texto completo.

A varredura é limitada por `maxFiles`, `maxFileBytes` e `timeoutMs`; o relatório lista os arquivos deixados para outra execução. Respeita as exceções do projeto de referência (lógica de programa e asserções de teste, avisos Semver de SDK públicos, limites de alto risco reescritos como pré-condições positivas e correspondências literais de entrada do usuário). Edita os arquivos diretamente e não executa uma suíte de testes: rode os testes do projeto depois de uma varredura que mude código.

## Result card, undo, and stop

O cartão de resultado renderiza um diff unificado próprio com cabeçalhos de hunk, números de linha e as cores de adicionado/removido do tema. Abre o primeiro arquivo alterado e recolhe os demais; cada linha mostra as contagens `+added` / `-deleted`.

- **Stop** aborta a varredura em andamento. Os arquivos já alterados continuam listados e mantêm o botão Undo; nenhuma nova requisição ao modelo ou escrita começa.
- **Undo** restaura aquele arquivo ao conteúdo anterior à varredura. Recusa sobrescrever um arquivo cujo conteúdo atual não corresponde mais à saída da varredura, e nunca aceita um caminho que a execução não registrou.
- Só é possível desfazer depois que a varredura termina. Não há desfazer em massa nem refazer.
- Uma varredura sem alterações se resume a uma única linha compacta em vez de um cartão vazio.
- O estado da execução vive no processo Host: após reiniciar o Host, o cartão volta ao resumo compacto do comando e não oferece ações.

O cartão usa três rotas exatas e autenticadas como owner fornecidas por Connection: `GET /api/doc-positivize.state?runId=…`, `POST /api/doc-positivize.cancel` e `POST /api/doc-positivize.undo`. A requisição de desfazer apenas seleciona um arquivo que a execução já alterou; não pode introduzir um novo destino de escrita.

## Compatibility

| Surface | Status |
|---|---|
| Harness | DeepSeek Harness `0.2.2-rc.1`; qualquer linha 0.2.x com `systemPrompt.section()`, `ctx.commands` e `ctx.llm` |
| Node | `^22.19.0 \|\| >=24.0.0` |
| Services | `systemPrompt`, `commands` e `llm`, todos em `@deepseek-ai/dsh-base`; o `connection` opcional habilita as rotas Stop/Undo do cartão |
| Client | GUI web: o pacote traz um cartão `dsh.client` e o cartão de resultado do `/positivize` para a página de Plugins |
| Runtime imports | `@deepseek-ai/schemastery` |
| Config | esquema Schemastery `Config`; valores inválidos falham no carregamento |

## Install

O repositório inclui os pontos de entrada já construídos, então instalar via Git é um único passo e não exige permissão de build:

```sh
# instalar direto do GitHub, sem aprovar allowBuilds
dsh plugin --profile <profile> add github:graydovee/dsh-doc-positivize

# confirme que a linha do bundle é montada
dsh --profile <profile> --dump-config | grep dsh-doc-positivize
```

Na página web **Plugins**, cole `github:graydovee/dsh-doc-positivize` (ou a URL do repositório) em **Adicionar plugin** para a mesma instalação. Para trabalhar no código ou instalar um tarball offline:

```sh
pnpm install
pnpm build          # regenera lib/; faça commit junto com a mudança
pnpm pack --pack-destination ./.pack

# uma especificação local precisa ser um caminho absoluto
dsh plugin --profile <profile> add "$PWD/.pack/dsh-doc-positivize-0.1.0-alpha.10.tgz"
```

Um `dsh plugin add` bem-sucedido também registra o pacote em `dsh.profile.bundles`; reinicie o aplicativo (ou recarregue o perfil) para ativá-lo.

## Configuration

| Key | Type | Default | Description |
|---|---|---|---|
| `guardEnabled` | boolean | `true` | monta a seção permanente da guarda |
| `guard` | string | guarda integrada em inglês | substitui toda a seção |
| `extra` | string | `""` | orientação do projeto acrescentada após uma linha em branco |
| `command` | boolean | `true` | registra o comando `/positivize` |
| `ignoredPaths` | string[] | lista embutida | nomes, caminhos ou globs que a varredura ignora |
| `maxFiles` | number | `12` | máximo de arquivos candidatos por varredura |
| `maxFileBytes` | number | `96000` | máximo de bytes de um arquivo enviado ao modelo |
| `timeoutMs` | number | `180000` | orçamento de tempo por varredura, em milissegundos |

## Settings

O pacote traz um cartão de configuração web, então o interruptor da guarda e a lista de ignorados são editáveis sem tocar em `cordis.patch.yml`:

- abra Configurações → **Doc Positivize**;
- **Enable the doc-positivize guard** liga ou desliga a regra permanente;
- **Ignored files and directories** é um editor multilinha, um nome, caminho ou glob por linha, para colar uma lista inteira; **Save** grava a entrada do perfil e **Restore defaults** volta à lista embutida.

Os resultados da varredura permitem desfazer por arquivo; uma varredura em andamento pode ser interrompida pelo cartão. As duas ações só existem enquanto o Host mantiver a execução.

A lista embutida é `node_modules`, `.git`, `dist`, `build`, `out`, `coverage`, `.next`, `.nuxt`, `.turbo`, `.cache`, `.pnpm-store`, `.pnpm-cache`, `.pack`, `target`, `vendor`, `.venv`, `__pycache__` e os lockfiles de pnpm, npm, yarn e bun. Um arquivo nomeado explicitamente é varrido mesmo quando seu diretório está na lista.

## Where it applies

A ordem `6000` ocupa a faixa vazia `5000`–`9000`: após as seções de ferramentas e antes do bloco de entregáveis e ambiente. A seção é global e seu texto é estático, preservando o cache de prefixo; custa cerca de 210 tokens por requisição. As chamadas ao modelo da varredura ocorrem no processo host e não entram na conversa, que paga apenas o ciclo de vida do comando.

## Development

```sh
pnpm install
pnpm typecheck
pnpm test          # testes unitários e integração com SystemPrompt e Commands reais
pnpm smoke:built   # compila e monta lib/index.js nos registros reais
node <dsh-plugin-guide>/dist/dsh-plugin-dev.js check --cwd .
```

`check` reporta um aviso: `packageManager` (`pnpm@10.34.6` local contra `pnpm@11.7.0`).

`0.1.0` é a primeira versão publicada. Compilações locais de depuração usam o sufixo `-alpha.N` da próxima versão (por exemplo `0.1.0-alpha.1`) e nunca são apresentadas como versões publicadas.

## Verify

`dsh-plugin-dev verify` empacota e instala em um `DSH_HOME` temporário. Os padrões da ferramenta miram o harness `0.1.5`, que a verificação de compatibilidade do `0.2.2-rc.1` rejeita, então fixe os dois pacotes:

```sh
node <dsh-plugin-guide>/dist/dsh-plugin-dev.js verify --cwd . \
  --base @deepseek-ai/dsh-base@0.2.2-rc.1 \
  --headless @deepseek-ai/dsh-headless@0.2.2-rc.1
```

Assim `pack`, `install` e `--dump-config` passam. O smoke sem credenciais termina em `TRANSPORT: DeepSeek Messages transport failed`; o arranque grava o prompt como evento `system/message`: procure ali a guarda.

## Attribution

A guarda e o fluxo de varredura são adaptados do projeto de referência [ox01024/pink-elephant](https://github.com/ox01024/pink-elephant) (MIT, Copyright © 2026 ox01024). Veja [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## License

Apache-2.0. Veja [LICENSE](LICENSE).
