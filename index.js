const github = require("@actions/github");
const core = require("@actions/core");
const graphql = require("@octokit/graphql");

async function run() {
    const myToken = core.getInput("action-token");
    const fieldId = core.getInput("field-id");
    const optionId = core.getInput("option-id");
    const projectId = core.getInput("project-id");
    const labelName = core.getInput("label-name");
    const milestoneName = core.getInput("milestone-name");
    // const ignoreList = core.getInput("columns-to-ignore");
    const context = github.context;

    if (!milestoneName && !labelName) {
        throw new Error("one of label-name and milestone-name must be set");
    } else if (milestoneName && labelName) {
        throw new Error("label-name and milestone-name cannot both be set");
    }

    var found = false;
    // var objectType;
    var baseObject;
    var nodeId;

    if (context.payload.issue) {
        baseObject = context.payload.issue;
        // objectType = "Issue";
    } else if (context.payload.pull_request) {
        baseObject = context.payload.pull_request;
        // objectType = "PullRequest";
    }

    nodeId = baseObject.node_id;

    if (baseObject && labelName) {
        baseObject.labels.forEach(function(item) {
            if (labelName == item.name) {
                found = true;
            }
        });
    }

    if (baseObject && milestoneName) {
        if (baseObject.milestone && baseObject.milestone.title == milestoneName) {
            found = true;
        }
    }

    if (found) {
        var cardId = await tryGetCardID(nodeId, myToken);
        console.log(`cardId is: ${cardId}`);

        if (cardId != null) {
            // card already exists for the issue
            // move card to the appropriate column
            return await moveExistingCard(cardId, fieldId, optionId, projectId, myToken);
        } else {
            // card is not present
            // create new card in the appropriate column
            // return await createNewCard(octokit, baseObject.id, objectType);
            throw new Error(`Card not found: ${cardId}`);
        }
    } else {
        // None of the labels match what we are looking for, non-indicative of a failure though
        return `Issue/PR #${baseObject.id} does not have a label that matches ${labelName}, ignoring`;
    }
}

// async function createNewCard(octokit, columnId, issueOrPrId, objectType) {
//     console.log(
//         `No card exists for the labeled ${objectType} in the project. Attempting to create a card in column ${columnId}, for the ${objectType} with the corresponding id #${issueOrPrId}`
//     );
//     await octokit.projects.createCard({
//         column_id: columnId,
//         content_id: issueOrPrId,
//         content_type: objectType,
//     });
//     return `Successfully created a new card in column #${columnId} for the ${objectType} with the corresponding id:${issueOrPrId} !`;
// }

async function moveExistingCard(cardId, fieldId, optionId, projectId, token) {
    var columnName = await tryGetColumnName(fieldId, optionId, token);
    console.log(
        `A card already exists for the issue. Attempting to move card #${cardId} to column #${columnName}`
    );
    const response = await graphql(
        `mutation ($fieldId: String!, $itemId: String!, $optionId: String!, $projectId: String!) ) {
            updateProjectV2ItemFieldValue(input: {
                fieldId: $fieldId
                projectId: $projectId
                itemId: $itemId
                value: {
                    singleSelectOptionId: $optionId
                }
            }) {
                projectV2Item {
                    id
                    content {
                        ... on Issue {
                            id
                            title
                        }
                    }
                    fieldValueByName(name: "Status") {
                        ... on ProjectV2ItemFieldSingleSelectValue {
                            id
                            name
                        }
                    }
                }
            }
        }`,
        {
            fieldId: fieldId,
            itemId: cardId,
            optionId: optionId,
            projectId: projectId,
            headers: {
                authorization: `bearer ${token}`,
            },
        }
    );
    if (response.errors) {
        throw new Error(response.errors[0].message);
    } else {
        columnName = response.updateProjectV2ItemFieldValue.projectV2Item.fieldValueByName.id;
    }
    return `Succesfully moved card #${cardId} to column #${columnName} !`;
}

async function tryGetCardID(nodeId, token) {
    var cardId = null;

    var cardInfo = await getCardInformation(nodeId, token);
    if (cardInfo.errors) {
        throw new Error(cardInfo.errors[0].message);
    } else {
        cardId = cardInfo.node.projectItems.nodes[0].id;
    }

    return cardId;
}

async function tryGetColumnName(fieldId, optionId, token) {
    var columnName = null;

    var columnInfo = await getColumnInformation(fieldId, token);
    if (columnInfo.errors) {
        throw new Error(columnInfo.errors[0].message);
    } else {
        var foundNode = columnInfo.node.options.find(function(node) {
            return optionId === node.id;
        });

        if (foundNode) {
            columnName = foundNode.name;
        }
    }

    return columnName;
}

async function getCardInformation(nodeId, token) {
    const response = await graphql(
        `
            query($nodeId: String!) {
                node(id: $nodeId) {
                    ... on Issue {
                        projectItems(includeArchived: false, first: 100) {
                            nodes {
                                id
                            }
                        }
                    }
                }
            }
        `,
        {
            nodeId: nodeId,
            headers: {
                authorization: `bearer ${token}`,
            },
        }
    );
    return response;
}

async function getColumnInformation(fieldId, token) {
    const response = await graphql(
        `
            query($fieldId: String!) {
                node(id: $fieldId) {
                    ... on ProjectV2SingleSelectField {
                        id
                        name
                        options {
                            id
                            name
                        }
                    }
                }
            }
        `,
        {
            fieldId: fieldId,
            headers: {
                authorization: `bearer ${token}`,
            },
        }
    );
    return response;
}

run().then(
    (response) => {
        console.log(`Finished running: ${response}`);
    },
    (error) => {
        console.log(`#ERROR# ${error}`);
        process.exit(1);
    }
);
