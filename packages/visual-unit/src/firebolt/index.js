import { FieldType } from 'muze-utils';
import { Firebolt, SpawnableSideEffect } from '@chartshq/muze-firebolt';
import { registerListeners } from './helper';
import { payloadGenerator } from './payload-generator';
import { propagateValues } from './data-propagator';

/**
 * This class manages the interactions of visual unit. It associates physical actions with
 * behavioural actions. It also propagates the behavioural actions to other datamodels.
 */
export default class UnitFireBolt extends Firebolt {
    constructor (...params) {
        super(...params);
        registerListeners(this);
    }

    propagate (behaviour, payload, selectionSet, sideEffects) {
        propagateValues(this, behaviour, {
            payload,
            selectionSet,
            sideEffects,
            propagationFields: this._propagationFields
        });
    }

    getApplicableSideEffects (sideEffects, payload, propagationInf) {
        const context = this.context;
        const unitId = context.id();
        const aliasName = context.parentAlias();
        const propagationSourceCanvas = propagationInf.propPayload && propagationInf.propPayload.sourceCanvas;
        const sourceUnitId = propagationInf.propPayload && propagationInf.propPayload.sourceUnit;
        const sourceSideEffects = this._sourceSideEffects;
        const actionOnSource = sourceUnitId ? sourceUnitId === unitId : true;

        const applicableSideEffects = payload.sideEffects ? [{
            effects: payload.sideEffects,
            behaviours: [payload.action]
        }] : sideEffects;
        applicableSideEffects.forEach((d) => {
            let mappedEffects = d.effects;
            mappedEffects = mappedEffects.filter((se) => {
                if (!actionOnSource && payload.criteria !== null) {
                    const sideEffectChecker = sourceSideEffects[se.name || se];
                    return sideEffectChecker ? sideEffectChecker(propagationInf.propPayload, context) : true;
                }
                if (propagationSourceCanvas === aliasName) {
                    return se.applyOnSource !== false;
                }
                return true;
            });
            d.effects = mappedEffects;
        });
        return applicableSideEffects;
    }

    shouldApplySideEffects (propagate) {
        return propagate === false;
    }

    onDataModelPropagation () {
        return (propValue) => {
            let isSourceFieldPresent = true;
            let isMutableAction = false;
            const data = propValue.data;
            const propPayload = propValue.payload;
            const sourceIdentifiers = propValue.sourceIdentifiers;
            const action = propPayload.action;
            const unitId = this.context.id();
            const payloadFn = payloadGenerator[action] || payloadGenerator.__default;

            if (sourceIdentifiers) {
                const fieldsConfig = sourceIdentifiers.getFieldsConfig();
                const sourceIdentifierFields = Object.keys(fieldsConfig);
                const propFields = Object.keys(data[0].getFieldsConfig());
                if (!Object.values(fieldsConfig).some(d => d.def.type === FieldType.MEASURE)) {
                    isSourceFieldPresent = sourceIdentifierFields.some(d => propFields.indexOf(d) !== -1);
                }
            }

            const sourceUnitId = propPayload.sourceUnit;
            const actionOnSource = sourceUnitId ? sourceUnitId === unitId : true;
            const payload = payloadFn(this.context, data, propValue);
            const sideEffects = this._behaviourEffectMap[action];
            const mutableEffect = sideEffects.find(sideEffect =>
                this._sideEffects[sideEffect.name || sideEffect].constructor.mutates(true));

            isMutableAction = !!mutableEffect;

            if (actionOnSource && mutableEffect && mutableEffect.applyOnSource === false) {
                isMutableAction = false;
            }

            const propagationInf = {
                propagate: false,
                data,
                propPayload,
                sourceIdentifiers,
                persistent: false,
                isSourceFieldPresent,
                sourceId: propValue.sourceId
            };
            this._actionHistory[action] = {
                payload,
                propagationInf,
                isMutableAction
            };
            this.dispatchBehaviour(action, payload, propagationInf);
        };
    }

    initializeSideEffects () {
        super.initializeSideEffects();
        const sideEffects = this.sideEffects();
        for (const key in sideEffects) {
            if ({}.hasOwnProperty.call(sideEffects, key)) {
                sideEffects[key] instanceof SpawnableSideEffect && sideEffects[key].drawingContext(() => {
                    const context = this.context;
                    return context.getDrawingContext();
                });
            }
        }
    }

    prepareSelectionSets (behaviours) {
        const data = this.context.data();
        if (data) {
            this.createSelectionSet(data.getData().uids, behaviours);
        }
        return this;
    }

    remove () {
        this.context.cachedData()[0].unsubscribe('propagation');
        return this;
    }
}
