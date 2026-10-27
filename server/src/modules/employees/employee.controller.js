import * as service from './employee.service.js';
import { created, ok } from '../../shared/http.js';

export async function list(req, res) {
  const { items, meta } = await service.listEmployees(req, req.validatedQuery);
  return ok(res, items, meta);
}

export const create = async (req, res) => created(res, await service.createEmployee(req, req.body));
export const get = async (req, res) => ok(res, await service.getEmployee(req, req.params.id));
export const update = async (req, res) => ok(res, await service.updateEmployee(req, req.params.id, req.body));
export const getOwn = async (req, res) => ok(res, await service.getOwnEmployee(req));
export const updateOwn = async (req, res) => ok(res, await service.updateOwnEmployee(req, req.body));
export const history = async (req, res) => ok(res, await service.getHistory(req, req.params.id));
export const lifecycle = async (req, res) => ok(res, await service.changeLifecycle(req, req.params.id, req.body));
export const probation = async (req, res) => ok(res, await service.changeProbation(req, req.params.id, req.body));
export const archive = async (req, res) => ok(res, await service.setArchived(req, req.params.id, true));
export const restore = async (req, res) => ok(res, await service.setArchived(req, req.params.id, false));
export const createAccount = async (req, res) => created(res, await service.createAccount(req, req.params.id));
export const getSensitive = async (req, res) => ok(res, await service.getSensitive(req, req.params.id, req.validatedQuery.reveal === 'true'));
export const updateSensitive = async (req, res) => ok(res, await service.updateSensitive(req, req.params.id, req.body));
