import { useMemo } from 'react';
import { Permissions, PermissionTypes, normalizeServerName } from 'librechat-data-provider';
import { useCatalogReady } from '../useCatalogWarmup';
import { useMCPServersQuery } from '~/data-provider';
import useHasAccess from '../Roles/useHasAccess';

/** These observers mount from rendered messages, so they must not pull the
 * server catalog onto the first-render path ahead of the warmup schedule. */
export function useMCPIconMap(): Map<string, string> {
  const mcpServersReady = useCatalogReady('mcpServers');
  // const { data: servers } = useMCPServersQuery({ enabled: mcpServersReady });
  const canUseMcp = useHasAccess({
    permissionType: PermissionTypes.MCP_SERVERS,
    permission: Permissions.USE,
  });
  const { data: servers } = useMCPServersQuery({ enabled: canUseMcp && mcpServersReady });

  return useMemo(() => {
    const map = new Map<string, string>();
    if (!servers) {
      return map;
    }
    for (const [serverName, config] of Object.entries(servers)) {
      if (config.iconPath) {
        /** Looked up with a server name parsed out of a tool key, which carries the
         *  normalized form, so key the map the same way. */
        map.set(normalizeServerName(serverName), config.iconPath);
      }
    }
    return map;
  }, [servers]);
}

/**
 * Configured MCP server names in the normalized form tool keys are built from,
 * so they can be matched against a key. The config is keyed by the raw name.
 */
export function useMCPServerNames(): string[] {
  const mcpServersReady = useCatalogReady('mcpServers');
  // const { data: servers } = useMCPServersQuery({ enabled: mcpServersReady });
  const canUseMcp = useHasAccess({
    permissionType: PermissionTypes.MCP_SERVERS,
    permission: Permissions.USE,
  });
  const { data: servers } = useMCPServersQuery({ enabled: canUseMcp && mcpServersReady });
  return useMemo(() => (servers ? Object.keys(servers).map(normalizeServerName) : []), [servers]);
}
