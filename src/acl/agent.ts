/**
 * Copyright 2020 Inrupt Inc.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal in
 * the Software without restriction, including without limitation the rights to use,
 * copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the
 * Software, and to permit persons to whom the Software is furnished to do so,
 * subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
 * INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
 * PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
 * HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
 * OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
 * SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

import {
  WithServerResourceInfo,
  WithChangeLog,
  WithAcl,
  AclDataset,
  Access,
  AclRule,
  IriString,
  WebId,
} from "../interfaces";
import { getIri, getIriAll } from "../thing/get";
import { acl } from "../constants";
import {
  hasResourceAcl,
  getResourceAcl,
  hasFallbackAcl,
  getFallbackAcl,
} from "./acl";
import {
  internal_duplicateAclRule,
  internal_initialiseAclRule,
  internal_combineAccessModes,
  internal_getAccess,
  internal_getAccessByIri,
  internal_getAclRules,
  internal_getAclRulesForIri,
  internal_getDefaultAclRulesForResource,
  internal_removeEmptyAclRules,
  internal_getResourceAclRulesForResource,
} from "./acl.internal";
import { getThingAll, setThing } from "../thing/thing";
import { removeIri, removeAll } from "../thing/remove";
import { setIri } from "../thing/set";

/**
 * ```{note} The Web Access Control specification is not yet finalised. As such, this
 * function is still experimental and subject to change, even in a non-major release.
 * ```
 */
export type AgentAccess = Record<WebId, Access>;

/**
 * ```{note}
 * This function is still experimental and subject to change, even in a non-major release.
 * ```
 *
 * Returns an Agent's explicitly-granted Access Modes for the given Resource.
 *
 * The function does not return Access Modes granted indirectly to the Agent through other
 * ACL rules, e.g., public or group-specific permissions.
 *
 * @param resourceInfo Information about the Resource to which the given Agent may have been granted access.
 * @param agent WebID of the Agent for which to retrieve what access it has to the Resource.
 * @returns Access Modes that have been explicitly granted to the Agent for the given Resource, or `null` if it could not be determined (e.g. because the current user does not have Control access to a given Resource or its Container).
 */
export function getAgentAccess(
  resourceInfo: WithAcl & WithServerResourceInfo,
  agent: WebId
): Access | null {
  if (hasResourceAcl(resourceInfo)) {
    return getAgentResourceAccess(resourceInfo.internal_acl.resourceAcl, agent);
  }
  if (hasFallbackAcl(resourceInfo)) {
    return getAgentDefaultAccess(resourceInfo.internal_acl.fallbackAcl, agent);
  }
  return null;
}

/**
 * ```{note}
 * This function is still experimental and subject to change, even in a non-major release.
 * ```
 * Returns all explicitly-granted Access Modes per Agent for the given Resource.
 *
 * The function does not return Access Modes granted indirectly to Agents through other
 * ACL rules, e.g., public or group-specific permissions.
 *
 * @param resourceInfo Information about the Resource to which Agents may have been granted access.
 * @returns Access Modes per Agent that have been explicitly granted for the given Resource, or `null` if it could not be determined (e.g. because the current user does not have Control access to a given Resource or its Container).
 */
export function getAgentAccessAll(
  resourceInfo: WithAcl & WithServerResourceInfo
): AgentAccess | null {
  if (hasResourceAcl(resourceInfo)) {
    const resourceAcl = getResourceAcl(resourceInfo);
    return getAgentResourceAccessAll(resourceAcl);
  }
  if (hasFallbackAcl(resourceInfo)) {
    const fallbackAcl = getFallbackAcl(resourceInfo);
    return getAgentDefaultAccessAll(fallbackAcl);
  }
  return null;
}

/**
 * ```{note}
 * This function is still experimental and subject to change, even in a non-major release.
 * ```
 *
 * Returns the Access Modes explicitly granted to an Agent for the Resource
 * associated with an ACL (Access ControlList).
 *
 * The function does not return:
 *
 * - Access Modes granted indirectly to the Agent through other ACL rules, e.g., public or group-specific permissions.
 * - Access Modes granted to the Agent for the child Resources if the associated Resource is a Container (see [[getAgentDefaultAccess]] instead).
 *
 * @param aclDataset The SolidDataset that contains ACL rules.
 * @param agent WebID of the Agent for which to retrieve what access it has to the Resource.
 * @returns Access Modes that have been explicitly granted to an Agent for the Resource associated with an ACL SolidDataset.
 */
export function getAgentResourceAccess(
  aclDataset: AclDataset,
  agent: WebId
): Access {
  const allRules = internal_getAclRules(aclDataset);
  const resourceRules = internal_getResourceAclRulesForResource(
    allRules,
    aclDataset.internal_accessTo
  );
  const agentResourceRules = getAgentAclRulesForAgent(resourceRules, agent);
  const agentAccessModes = agentResourceRules.map(internal_getAccess);
  return internal_combineAccessModes(agentAccessModes);
}

/**
 * ```{note}
 * This function is still experimental and subject to change, even in a non-major release.
 * ```
 *
 * Returns the explicitly granted Access Modes per Agent for the Resource associated
 * with an ACL (Access Control List).
 *
 * The function does not return:
 *
 * - Access Modes granted indirectly to Agents through other ACL rules, e.g., public or group-specific permissions.
 * - Access Modes granted to Agents for the child Resources if the associated Resource is a Container.
 *
 * @param aclDataset The SolidDataset that contains ACL rules.
 * @returns Access Modes per Agent that have been explicitly granted for the Resource associated with an ACL SolidDataset.
 */
export function getAgentResourceAccessAll(aclDataset: AclDataset): AgentAccess {
  const allRules = internal_getAclRules(aclDataset);
  const resourceRules = internal_getResourceAclRulesForResource(
    allRules,
    aclDataset.internal_accessTo
  );
  const agentResourceRules = getAgentAclRules(resourceRules);
  return getAccessByAgent(agentResourceRules);
}

/**
 * ```{note}
 * This function is still experimental and subject to change, even in a non-major release.
 * ```
 * Modifies the resource ACL (Access Control List) to set the Access Modes for the given Agent.
 * Specifically, the function returns a new resource ACL initialised with the given ACL and
 * new rules for the Agent's access.
 *
 * If rules for Agent's access already exist in the given ACL, in the returned ACL,
 * they are replaced by the new rules.
 *
 * This function does not modify:
 *
 * - Access Modes granted indirectly to Agents through other ACL rules, e.g., public or group-specific permissions.
 * - Access Modes granted to Agents for the child Resources if the associated Resource is a Container.
 * - The original ACL.
 *
 * @param aclDataset The SolidDataset that contains Access-Control List rules.
 * @param agent The Agent to grant specific Access Modes.
 * @param access The Access Modes to grant to the Agent for the Resource.
 * @returns A new resource ACL initialised with the given `aclDataset` and `access` for the `agent`.
 */
export function setAgentResourceAccess(
  aclDataset: AclDataset,
  agent: WebId,
  access: Access
): AclDataset & WithChangeLog {
  // First make sure that none of the pre-existing rules in the given ACL SolidDataset
  // give the Agent access to the Resource:
  let filteredAcl = aclDataset;
  getThingAll(aclDataset).forEach((aclRule) => {
    // Obtain both the Rule that no longer includes the given Agent,
    // and a new Rule that includes all ACL Quads
    // that do not pertain to the given Agent-Resource combination.
    // Note that usually, the latter will no longer include any meaningful statements;
    // we'll clean them up afterwards.
    const [filteredRule, remainingRule] = removeAgentFromRule(
      aclRule,
      agent,
      aclDataset.internal_accessTo,
      "resource"
    );
    filteredAcl = setThing(filteredAcl, filteredRule);
    filteredAcl = setThing(filteredAcl, remainingRule);
  });

  // Create a new Rule that only grants the given Agent the given Access Modes:
  let newRule = internal_initialiseAclRule(access);
  newRule = setIri(newRule, acl.accessTo, aclDataset.internal_accessTo);
  newRule = setIri(newRule, acl.agent, agent);
  const updatedAcl = setThing(filteredAcl, newRule);

  // Remove any remaining Rules that do not contain any meaningful statements:
  const cleanedAcl = internal_removeEmptyAclRules(updatedAcl);

  return cleanedAcl;
}

/**
 * ```{note}
 * This function is still experimental and subject to change, even in a non-major release.
 * ```
 *
 * Returns an Agent's Access Modes explicitly granted for the children of the
 * Container associated with the given ACL (Access Control List).
 *
 * The function does not return:
 * - Access Modes granted indirectly to the Agent through other ACL rules, e.g. public or group-specific permissions.
 * - Access Modes granted to the Agent for the Container Resource itself (see [[getAgentResourceAccess]] instead).
 *
 * @param aclDataset The SolidDataset that contains Access-Control List rules for a certain Container.
 * @param agent WebID of the Agent for which to retrieve what access it has to the Container's children.
 * @returns Access Modes that have been explicitly granted to an Agent for the children of the Container associated with the given ACL.
 */
export function getAgentDefaultAccess(
  aclDataset: AclDataset,
  agent: WebId
): Access {
  const allRules = internal_getAclRules(aclDataset);
  const resourceRules = internal_getDefaultAclRulesForResource(
    allRules,
    aclDataset.internal_accessTo
  );
  const agentResourceRules = getAgentAclRulesForAgent(resourceRules, agent);
  const agentAccessModes = agentResourceRules.map(internal_getAccess);
  return internal_combineAccessModes(agentAccessModes);
}

/**
 * ```{note}
 * This function is still experimental and subject to change, even in a non-major release.
 * ```
 *
 * Returns the Access Modes, per Agent, that have been explicitly granted for the children
 * of the Container associated with the given ACL (Access Control List).
 *
 * The function does not return:
 *
 * - Access Modes granted indirectly to the Agents through other ACL rules, e.g. public or group-specific permissions.
 * - Access Modes granted to the Agents for the Container Resource itself (see [[getAgentResourceAccessAll]] instead).
 *
 * @param aclDataset The SolidDataset that contains Access-Control List rules.
 * @returns Access Modes, per Agent, that have been explicitly granted for the children of the Container associated with the given ACL.
 */
export function getAgentDefaultAccessAll(aclDataset: AclDataset): AgentAccess {
  const allRules = internal_getAclRules(aclDataset);
  const resourceRules = internal_getDefaultAclRulesForResource(
    allRules,
    aclDataset.internal_accessTo
  );
  const agentResourceRules = getAgentAclRules(resourceRules);

  return getAccessByAgent(agentResourceRules);
}

/**
 * ```{note}
 * This function is still experimental and subject to change, even in a non-major release.
 * ```
 *
 * Modifies the default ACL (Access Control List) to set an Agent's Access Modes for the Container's children.
 * Specifically, the function returns a new default ACL initialised with the given ACL and
 * new rules for the Agent's access.
 *
 * If rules already exist for the Agent in the given ACL, in the returned ACL, they are replaced by the new rules.
 *
 * This function does not modify:
 * - Access Modes granted indirectly to the Agent through other ACL rules, e.g., public or group-specific permissions.
 * - Access Modes granted to the Agent for the Container Resource itself.
 * - The original ACL.
 *
 * @param aclDataset The SolidDataset that contains Access-Control List rules.
 * @param agent The Agent to grant specific Access Modes.
 * @param access The Access Modes to grant to the Agent.
 * @returns A new default ACL initialised with the given `aclDataset` and `access` for the `agent`.
 */
export function setAgentDefaultAccess(
  aclDataset: AclDataset,
  agent: WebId,
  access: Access
): AclDataset & WithChangeLog {
  // First make sure that none of the pre-existing rules in the given ACL SolidDataset
  // give the Agent default access to the Resource:
  let filteredAcl = aclDataset;
  getThingAll(aclDataset).forEach((aclRule) => {
    // Obtain both the Rule that no longer includes the given Agent,
    // and a new Rule that includes all ACL Quads
    // that do not pertain to the given Agent-Resource default combination.
    // Note that usually, the latter will no longer include any meaningful statements;
    // we'll clean them up afterwards.
    const [filteredRule, remainingRule] = removeAgentFromRule(
      aclRule,
      agent,
      aclDataset.internal_accessTo,
      "default"
    );
    filteredAcl = setThing(filteredAcl, filteredRule);
    filteredAcl = setThing(filteredAcl, remainingRule);
  });

  // Create a new Rule that only grants the given Agent the given default Access Modes:
  let newRule = internal_initialiseAclRule(access);
  newRule = setIri(newRule, acl.default, aclDataset.internal_accessTo);
  newRule = setIri(newRule, acl.agent, agent);
  const updatedAcl = setThing(filteredAcl, newRule);

  // Remove any remaining Rules that do not contain any meaningful statements:
  const cleanedAcl = internal_removeEmptyAclRules(updatedAcl);

  return cleanedAcl;
}

function getAgentAclRulesForAgent(
  aclRules: AclRule[],
  agent: WebId
): AclRule[] {
  return internal_getAclRulesForIri(aclRules, agent, acl.agent);
}

function getAgentAclRules(aclRules: AclRule[]): AclRule[] {
  return aclRules.filter(isAgentAclRule);
}

function isAgentAclRule(aclRule: AclRule): boolean {
  return getIri(aclRule, acl.agent) !== null;
}

/**
 * Given an ACL Rule, returns two new ACL Rules that cover all the input Rule's use cases,
 * except for giving the given Agent access to the given Resource.
 *
 * @param rule The ACL Rule that should no longer apply for a given Agent to a given Resource.
 * @param agent The Agent that should be removed from the Rule for the given Resource.
 * @param resourceIri The Resource to which the Rule should no longer apply for the given Agent.
 * @returns A tuple with the original ACL Rule without the given Agent, and a new ACL Rule for the given Agent for the remaining Resources, respectively.
 */
function removeAgentFromRule(
  rule: AclRule,
  agent: WebId,
  resourceIri: IriString,
  ruleType: "resource" | "default"
): [AclRule, AclRule] {
  // If the existing Rule does not apply to the given Agent, we don't need to split up.
  // Without this check, we'd be creating a new rule for the given Agent (ruleForOtherTargets)
  // that would give it access it does not currently have:
  if (!getIriAll(rule, acl.agent).includes(agent)) {
    const emptyRule = internal_initialiseAclRule({
      read: false,
      append: false,
      write: false,
      control: false,
    });
    return [rule, emptyRule];
  }
  // The existing rule will keep applying to Agents other than the given one:
  const ruleWithoutAgent = removeIri(rule, acl.agent, agent);
  // The agent might have been given other access in the existing rule, so duplicate it...
  let ruleForOtherTargets = internal_duplicateAclRule(rule);
  // ...but remove access to the original Resource...
  ruleForOtherTargets = removeIri(
    ruleForOtherTargets,
    ruleType === "resource" ? acl.accessTo : acl.default,
    resourceIri
  );
  // Prevents the legacy predicate 'acl:defaultForNew' to lead to privilege escalation
  if (ruleType === "default") {
    ruleForOtherTargets = removeIri(
      ruleForOtherTargets,
      acl.defaultForNew,
      resourceIri
    );
  }
  // ...and only apply the new Rule to the given Agent (because the existing Rule covers the others):
  ruleForOtherTargets = setIri(ruleForOtherTargets, acl.agent, agent);
  ruleForOtherTargets = removeAll(ruleForOtherTargets, acl.agentClass);
  ruleForOtherTargets = removeAll(ruleForOtherTargets, acl.agentGroup);
  ruleForOtherTargets = removeAll(ruleForOtherTargets, acl.origin);

  return [ruleWithoutAgent, ruleForOtherTargets];
}

function getAccessByAgent(aclRules: AclRule[]): AgentAccess {
  return internal_getAccessByIri(aclRules, acl.agent);
}
