import { v7 } from 'uuid'

/** Default uuid state sequences equal-millisecond calls and holds time on clock
 * rollback within this runtime. Fixed SDK releases are upgraded separately. */
export const newUuid = () => v7()
export const isUuidV7 = value => typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)

const ids = value => Array.isArray(value) && value.every(isUuidV7)
function menus(value) {
  if (!Array.isArray(value)) return false
  const pending = [...value], seen = new Set()
  while (pending.length) {
    const menu = pending.pop()
    if (!isUuidV7(menu?.id) || (menu.parentId != null && !isUuidV7(menu.parentId)) || seen.has(menu)) return false
    seen.add(menu)
    if (menu.children !== undefined) {
      if (!Array.isArray(menu.children)) return false
      for (const child of menu.children) pending.push(child)
    }
  }
  return true
}

/** Validate only fields whose existing contract denotes system-owned UUIDs. */
export function hasV7ContextIds(props) {
  return isUuidV7(props?.user?.id) && isUuidV7(props?.tenant?.id) && isUuidV7(props?.organization?.id) &&
    (props.organizationScopeIds == null || ids(props.organizationScopeIds)) &&
    (props.roles === undefined || (Array.isArray(props.roles) && props.roles.every(role => isUuidV7(role?.id)))) &&
    (props.menus === undefined || menus(props.menus)) &&
    (props.dataGrants === undefined || (Array.isArray(props.dataGrants) && props.dataGrants.every(grant =>
      isUuidV7(grant?.subjectUserId) && isUuidV7(grant?.tenantId) && ids(grant?.organizationIds)))) &&
    (props.entryVersionId == null || isUuidV7(props.entryVersionId))
}
