# Architecture

HackOn has six separable layers:

1. **Workflows** define a DAG of stages, permissions, dependencies, retries,
   and blocking quality gates.
2. **Skills** are host-neutral methodology documents. They guide an adapter but
   never count as evidence by themselves.
3. **Orchestrator** acquires bounded context, executes ready stages, persists
   checkpoints, resumes incomplete stages, and propagates failure.
4. **Adapters** translate an agent task into a host action. Factory Droid is
   the production adapter; OpenCode is a compatibility adapter.
5. **Tools** execute controlled argv vectors without a shell and return command
   provenance.
6. **Evidence and gates** decide whether a stage can complete.

The runtime stores runs and learning under `.hackon/`. Run state is JSON so
operators can inspect it and future storage adapters can replace it without
changing the domain contracts.
