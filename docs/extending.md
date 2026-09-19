# Extending HackOn

Add a domain contract before adding a workflow stage. Implement a new
`AgentAdapter` for host integration, a `ToolExecutor` for controlled tools, or
a `KnowledgeStore` for retrieval. Add evidence and a blocking gate rather than
encoding completion in agent prose.

New stages must declare dependencies, writes, permissions, retry behavior, and
gates. Read-only reviewers may run concurrently; write stages must be isolated
or serialized.
